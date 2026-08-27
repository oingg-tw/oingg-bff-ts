import { getPrismaClient } from "../../adapters/neon/index.js";

export interface ColumnPresetRow {
  id: number;
  name: string;
  isDefault: boolean;
  columns: string[];
  createdAt: string;
  updatedAt: string;
}

const COLUMNS_ORDER = { position: "asc" as const };

function toRow(preset: {
  id: number;
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

export async function listColumnPresets(firebaseUid: string): Promise<ColumnPresetRow[]> {
  const prisma = getPrismaClient();
  const presets = await prisma.columnPreset.findMany({
    where: { firebaseUid },
    orderBy: { createdAt: "desc" },
    include: { columns: { orderBy: COLUMNS_ORDER } },
  });
  return presets.map(toRow);
}

export async function findColumnPreset(firebaseUid: string, id: number): Promise<ColumnPresetRow | null> {
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
    const preset = await tx.columnPreset.create({
      data: {
        firebaseUid,
        name,
        isDefault,
        columns: { create: fields.map((field, position) => ({ field, position })) },
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
  id: number,
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

export async function deleteColumnPreset(firebaseUid: string, id: number): Promise<boolean> {
  const prisma = getPrismaClient();
  const result = await prisma.columnPreset.deleteMany({ where: { firebaseUid, id } });
  return result.count > 0;
}
