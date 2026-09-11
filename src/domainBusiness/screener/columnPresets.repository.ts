import { getPrismaClient } from "@/adapters/neon/index.js";

export interface ColumnPresetRow {
  id: string;
  name: string;
  isDefault: boolean;
  columns: string[];
  createdAt: string;
  updatedAt: string;
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

export interface ColumnPresetUpdate {
  name?: string;
  columns?: string[];
  isDefault?: boolean;
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
    for (const [position, id] of orderedIds.entries()) {
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
