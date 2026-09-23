import { getPrismaClient } from "@/infrastructure/prisma/index.js";

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
  sectorCodes: string[];
  excludeSectorCodes: string[];
  lastColumnPresetId: string | null;
  createdAt: string;
  updatedAt: string;
}

const PRESETS_ORDER = { position: "asc" as const };

export interface PresetFilterInput {
  metricKey: string;
  fieldKey: string;
  min: number | null;
  max: number | null;
  exclude: boolean;
}

const FILTERS_ORDER = { position: "asc" as const };

/** sectorCodes is stored as a plain JSON array (see schema.prisma) — analysis-ts is the sole validation authority, no local catalog to check against. */
function normalizeSectorCodes(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

function toPresetRow(preset: {
  id: string;
  name: string;
  sectorCodes: unknown;
  excludeSectorCodes: unknown;
  lastColumnPresetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  filters: Array<{ metricKey: string; fieldKey: string; min: number | null; max: number | null; exclude: boolean }>;
}): PresetRow {
  return {
    id: preset.id,
    name: preset.name,
    sectorCodes: normalizeSectorCodes(preset.sectorCodes),
    excludeSectorCodes: normalizeSectorCodes(preset.excludeSectorCodes),
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

/** Ordered by the user's own drag-to-reorder position (see ScreenerPreset.position), not creation time. */
export async function listPresets(firebaseUid: string): Promise<PresetRow[]> {
  const prisma = getPrismaClient();
  const presets = await prisma.screenerPreset.findMany({
    where: { firebaseUid },
    orderBy: PRESETS_ORDER,
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
  sectorCodes: string[] = [],
  excludeSectorCodes: string[] = [],
): Promise<PresetRow> {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    // Appended to the end of this user's own tab order — count rather than max(position)+1 since a
    // brand-new user has no rows at all (max would be null, not 0).
    const position = await tx.screenerPreset.count({ where: { firebaseUid } });
    const preset = await tx.screenerPreset.create({
      data: {
        firebaseUid,
        name,
        position,
        sectorCodes,
        excludeSectorCodes,
        filters: {
          create: filters.map((f, filterPosition) => ({
            metricKey: f.metricKey,
            fieldKey: f.fieldKey,
            min: f.min,
            max: f.max,
            exclude: f.exclude,
            position: filterPosition,
          })),
        },
      },
      include: { filters: { orderBy: FILTERS_ORDER } },
    });
    return toPresetRow(preset);
  });
}

export interface PresetUpdate {
  name?: string;
  filters?: PresetFilterInput[];
  sectorCodes?: string[];
  excludeSectorCodes?: string[];
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

    if (update.name !== undefined || update.sectorCodes !== undefined || update.excludeSectorCodes !== undefined) {
      await tx.screenerPreset.update({
        where: { id },
        data: {
          ...(update.name !== undefined ? { name: update.name } : {}),
          ...(update.sectorCodes !== undefined ? { sectorCodes: update.sectorCodes } : {}),
          ...(update.excludeSectorCodes !== undefined ? { excludeSectorCodes: update.excludeSectorCodes } : {}),
        },
      });
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

/**
 * Reassigns position = array index for every id in `orderedIds`, all in one transaction. Returns null
 * (no writes made) if `orderedIds` isn't exactly this user's current full set of preset ids — same
 * "requires the complete set" rule as columnPresets.repository.ts's reorderColumnPresets.
 */
export async function reorderPresets(firebaseUid: string, orderedIds: string[]): Promise<PresetRow[] | null> {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.screenerPreset.findMany({ where: { firebaseUid }, select: { id: true } });
    const existingIds = new Set(existing.map((row) => row.id));
    const requestedIds = new Set(orderedIds);
    if (existingIds.size !== requestedIds.size || [...existingIds].some((id) => !requestedIds.has(id))) {
      return null;
    }

    // Sequential, not Promise.all — a single Postgres connection (this transaction) processes one query
    // at a time regardless, and concurrent awaits against the same tx client risk interleaving badly.
    for (const [position, id] of orderedIds.entries()) {
      await tx.screenerPreset.update({ where: { id }, data: { position } });
    }

    const reordered = await tx.screenerPreset.findMany({
      where: { firebaseUid },
      orderBy: PRESETS_ORDER,
      include: { filters: { orderBy: FILTERS_ORDER } },
    });
    return reordered.map(toPresetRow);
  });
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

/** Cheap COUNT for the quota guard — avoids loading and mapping every preset just to check a ceiling. */
export async function countPresets(firebaseUid: string): Promise<number> {
  const prisma = getPrismaClient();
  return prisma.screenerPreset.count({ where: { firebaseUid } });
}
