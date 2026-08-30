import { getPrismaClient } from "../../adapters/neon/index.js";

export interface PresetFilterRow {
  metricKey: string;
  fieldKey: string;
  min: number | null;
  max: number | null;
  exclude: boolean;
}

export interface PresetRow {
  id: string;
  name: string;
  filters: PresetFilterRow[];
  lastColumnPresetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PresetFilterInput {
  metricKey: string;
  fieldKey: string;
  min: number | null;
  max: number | null;
  exclude: boolean;
}

const FILTERS_ORDER = { position: "asc" as const };

function toPresetRow(preset: {
  id: string;
  name: string;
  lastColumnPresetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  filters: Array<{ metricKey: string; fieldKey: string; min: number | null; max: number | null; exclude: boolean }>;
}): PresetRow {
  return {
    id: preset.id,
    name: preset.name,
    lastColumnPresetId: preset.lastColumnPresetId,
    createdAt: preset.createdAt.toISOString(),
    updatedAt: preset.updatedAt.toISOString(),
    filters: preset.filters.map((f) => ({
      metricKey: f.metricKey,
      fieldKey: f.fieldKey,
      min: f.min,
      max: f.max,
      exclude: f.exclude,
    })),
  };
}

export async function listPresets(firebaseUid: string): Promise<PresetRow[]> {
  const prisma = getPrismaClient();
  const presets = await prisma.screenerPreset.findMany({
    where: { firebaseUid },
    orderBy: { createdAt: "desc" },
    include: { filters: { orderBy: FILTERS_ORDER } },
  });
  return presets.map(toPresetRow);
}

export async function findPreset(firebaseUid: string, id: string): Promise<PresetRow | null> {
  const prisma = getPrismaClient();
  const preset = await prisma.screenerPreset.findFirst({
    where: { firebaseUid, id },
    include: { filters: { orderBy: FILTERS_ORDER } },
  });
  return preset ? toPresetRow(preset) : null;
}

export async function createPreset(
  firebaseUid: string,
  name: string,
  filters: PresetFilterInput[],
): Promise<PresetRow> {
  const prisma = getPrismaClient();
  const preset = await prisma.screenerPreset.create({
    data: {
      firebaseUid,
      name,
      filters: {
        create: filters.map((f, position) => ({
          metricKey: f.metricKey,
          fieldKey: f.fieldKey,
          min: f.min,
          max: f.max,
          exclude: f.exclude,
          position,
        })),
      },
    },
    include: { filters: { orderBy: FILTERS_ORDER } },
  });
  return toPresetRow(preset);
}

export interface PresetUpdate {
  name?: string;
  filters?: PresetFilterInput[];
}

/** Updates the name and/or replaces the whole filter set (not incremental) for a preset the user owns. */
export async function updatePreset(
  firebaseUid: string,
  id: string,
  update: PresetUpdate,
): Promise<PresetRow | null> {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.screenerPreset.findFirst({ where: { firebaseUid, id } });
    if (!existing) {
      return null;
    }

    if (update.name !== undefined) {
      await tx.screenerPreset.update({ where: { id }, data: { name: update.name } });
    } else {
      // Bump updatedAt even when only filters change.
      await tx.screenerPreset.update({ where: { id }, data: {} });
    }

    if (update.filters !== undefined) {
      await tx.screenerPresetFilter.deleteMany({ where: { presetId: id } });
      if (update.filters.length > 0) {
        await tx.screenerPresetFilter.createMany({
          data: update.filters.map((f, position) => ({
            presetId: id,
            metricKey: f.metricKey,
            fieldKey: f.fieldKey,
            min: f.min,
            max: f.max,
            exclude: f.exclude,
            position,
          })),
        });
      }
    }

    const updated = await tx.screenerPreset.findFirstOrThrow({
      where: { id },
      include: { filters: { orderBy: FILTERS_ORDER } },
    });
    return toPresetRow(updated);
  });
}

export async function deletePreset(firebaseUid: string, id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const result = await prisma.screenerPreset.deleteMany({ where: { firebaseUid, id } });
  return result.count > 0;
}

/** Remembers which ColumnPreset this ScreenerPreset was last viewed with (see runPreset). */
export async function setLastColumnPreset(
  firebaseUid: string,
  id: string,
  columnPresetId: string,
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.screenerPreset.updateMany({ where: { firebaseUid, id }, data: { lastColumnPresetId: columnPresetId } });
}
