import { Prisma } from "@/generated/prisma/client.js";
import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import { positionsInLockOrder } from "@/infrastructure/prisma/lockOrder.js";
import type { ColumnPresetsPort } from "@/application/ports/columnPresets.js";
import type { ColumnPresetRow, ColumnPresetUpdate } from "@/application/screener/columnPresets.types.js";

/** Prisma's code for a unique constraint violation (wraps Postgres's own 23505). */
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION;
}

const COLUMNS_ORDER = { position: "asc" as const };
const PRESETS_ORDER = { position: "asc" as const };

function toRow(preset: {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  columns: Array<{ field: string }>;
}): ColumnPresetRow {
  return {
    id: preset.id,
    name: preset.name,
    isDefault: preset.isDefault,
    columns: preset.columns.map((c) => c.field),
    createdAt: preset.createdAt.toISOString(),
    updatedAt: preset.updatedAt.toISOString(),
  };
}

/** Ordered by the user's own drag-to-reorder position (see ColumnPreset.position), not creation time. */
export async function listColumnPresets(firebaseUid: string): Promise<ColumnPresetRow[]> {
  const prisma = getPrismaClient();
  const presets = await prisma.columnPreset.findMany({
    where: { firebaseUid },
    orderBy: PRESETS_ORDER,
    include: { columns: { orderBy: COLUMNS_ORDER } },
  });
  return presets.map(toRow);
}

export async function findColumnPreset(firebaseUid: string, id: string): Promise<ColumnPresetRow | null> {
  const prisma = getPrismaClient();
  const preset = await prisma.columnPreset.findFirst({
    where: { firebaseUid, id },
    include: { columns: { orderBy: COLUMNS_ORDER } },
  });
  return preset ? toRow(preset) : null;
}

export async function findDefaultColumnPreset(firebaseUid: string): Promise<ColumnPresetRow | null> {
  const prisma = getPrismaClient();
  const preset = await prisma.columnPreset.findFirst({
    where: { firebaseUid, isDefault: true },
    include: { columns: { orderBy: COLUMNS_ORDER } },
  });
  return preset ? toRow(preset) : null;
}

export async function createColumnPreset(
  firebaseUid: string,
  name: string,
  fields: string[],
  isDefault: boolean,
): Promise<ColumnPresetRow> {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.columnPreset.updateMany({ where: { firebaseUid, isDefault: true }, data: { isDefault: false } });
    }
    // Appended to the end of this user's own tab order — count rather than max(position)+1 since a
    // brand-new user has no rows at all (max would be null, not 0).
    const position = await tx.columnPreset.count({ where: { firebaseUid } });
    const preset = await tx.columnPreset.create({
      data: {
        firebaseUid,
        name,
        isDefault,
        position,
        columns: { create: fields.map((field, fieldPosition) => ({ field, position: fieldPosition })) },
      },
      include: { columns: { orderBy: COLUMNS_ORDER } },
    });
    return toRow(preset);
  });
}

/** Updates name/isDefault and/or replaces the whole column set (not incremental) for a preset the user owns. */
export async function updateColumnPreset(
  firebaseUid: string,
  id: string,
  update: ColumnPresetUpdate,
): Promise<ColumnPresetRow | null> {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.columnPreset.findFirst({ where: { firebaseUid, id } });
    if (!existing) {
      return null;
    }

    if (update.isDefault === true) {
      await tx.columnPreset.updateMany({
        where: { firebaseUid, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }

    await tx.columnPreset.update({
      where: { id },
      data: {
        ...(update.name !== undefined ? { name: update.name } : {}),
        ...(update.isDefault !== undefined ? { isDefault: update.isDefault } : {}),
      },
    });

    if (update.columns !== undefined) {
      await tx.columnPresetField.deleteMany({ where: { presetId: id } });
      if (update.columns.length > 0) {
        await tx.columnPresetField.createMany({
          data: update.columns.map((field, position) => ({ presetId: id, field, position })),
        });
      }
    }

    const updated = await tx.columnPreset.findFirstOrThrow({
      where: { id },
      include: { columns: { orderBy: COLUMNS_ORDER } },
    });
    return toRow(updated);
  });
}

export async function deleteColumnPreset(firebaseUid: string, id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const result = await prisma.columnPreset.deleteMany({ where: { firebaseUid, id } });
  return result.count > 0;
}

/**
 * Reassigns position = array index for every id in `orderedIds`, all in one transaction. Returns null
 * (no writes made) if `orderedIds` isn't exactly this user's current full set of preset ids — a partial
 * reorder is ambiguous (where would the omitted ones go?), so this requires the complete set, same
 * "full replacement, not incremental" rule PATCH already uses for columns/filters.
 */
export async function reorderColumnPresets(firebaseUid: string, orderedIds: string[]): Promise<ColumnPresetRow[] | null> {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.columnPreset.findMany({ where: { firebaseUid }, select: { id: true } });
    const existingIds = new Set(existing.map((row) => row.id));
    const requestedIds = new Set(orderedIds);
    if (existingIds.size !== requestedIds.size || [...existingIds].some((id) => !requestedIds.has(id))) {
      return null;
    }

    // Sequential, not Promise.all — a single Postgres connection (this transaction) processes one query
    // at a time regardless, and concurrent awaits against the same tx client risk interleaving badly.
    // 依 id 順序鎖列，並發的 reorder 才不會死結（見 lockOrder.ts）。
    for (const [position, id] of positionsInLockOrder(orderedIds)) {
      await tx.columnPreset.update({ where: { id }, data: { position } });
    }

    const reordered = await tx.columnPreset.findMany({
      where: { firebaseUid },
      orderBy: PRESETS_ORDER,
      include: { columns: { orderBy: COLUMNS_ORDER } },
    });
    return reordered.map(toRow);
  });
}

export async function findColumnPresetByName(firebaseUid: string, name: string): Promise<ColumnPresetRow | null> {
  const prisma = getPrismaClient();
  const row = await prisma.columnPreset.findUnique({
    where: { firebaseUid_name: { firebaseUid, name } },
    include: { columns: { orderBy: COLUMNS_ORDER } },
  });
  return row ? toRow(row) : null;
}

/** Cheap COUNT for the quota guard — see countPresets in screenerPresets.repository.ts. */
export async function countColumnPresets(firebaseUid: string): Promise<number> {
  const prisma = getPrismaClient();
  return prisma.columnPreset.count({ where: { firebaseUid } });
}

/**
 * ColumnPresetsPort 的 Prisma 實作——跟 prismaScreenerPresets 對稱，同樣的理由（見該處說明）：
 * P2002 與「沒有這一列」都在這裡翻譯成值，application 不必認得任何一個資料庫的錯誤分類。
 */
export const prismaColumnPresets: ColumnPresetsPort = {
  list: listColumnPresets,
  find: findColumnPreset,
  findDefault: findDefaultColumnPreset,
  async create(firebaseUid, name, columns, isDefault) {
    try {
      return { ok: true, row: await createColumnPreset(firebaseUid, name, columns, isDefault) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, reason: "duplicate" };
      }
      throw error;
    }
  },
  async update(firebaseUid, id, update) {
    try {
      const row = await updateColumnPreset(firebaseUid, id, update);
      return row ? { ok: true, row } : { ok: false, reason: "not-found" };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, reason: "duplicate" };
      }
      throw error;
    }
  },
  remove: deleteColumnPreset,
  reorder: reorderColumnPresets,
  count: countColumnPresets,
  findByName: findColumnPresetByName,
};
