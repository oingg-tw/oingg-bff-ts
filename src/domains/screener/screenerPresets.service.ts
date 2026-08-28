import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../shared/errorHandler.js";
import { parseFieldRef, toFieldRefString } from "../../shared/fieldRef.js";
import { findFilterField } from "../filterCatalog/index.js";
import { ensureDefaultColumnPreset, resolveScreenerColumns } from "./columnPresets.service.js";
import { runScreener } from "./screener.service.js";
import type { ScreenerFilter, ScreenerResult } from "./screener.types.js";
import {
  createPreset,
  deletePreset,
  findPreset,
  listPresets,
  setLastColumnPreset,
  updatePreset,
  type PresetFilterInput,
  type PresetRow,
} from "./screenerPresets.repository.js";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION;
}

export interface PresetFilterView {
  field: string;
  min: number | null;
  max: number | null;
  exclude: boolean;
}

export interface PresetView {
  id: number;
  name: string;
  filters: PresetFilterView[];
  lastColumnPresetId: number | null;
  createdAt: string;
  updatedAt: string;
}

function toView(row: PresetRow): PresetView {
  return {
    id: row.id,
    name: row.name,
    filters: row.filters.map((f) => ({
      field: toFieldRefString(f.metricKey, f.fieldKey),
      min: f.min,
      max: f.max,
      exclude: f.exclude,
    })),
    lastColumnPresetId: row.lastColumnPresetId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Validates every filter's field exists in the catalog and resolves it to (metricKey, fieldKey). */
async function resolveFilters(filters: ScreenerFilter[]): Promise<PresetFilterInput[]> {
  return Promise.all(
    filters.map(async (filter) => {
      const { metricKey, fieldKey } = parseFieldRef(filter.field);
      const lookup = await findFilterField(metricKey, fieldKey);
      if (!lookup) {
        throw new AppError(`Unknown filter field "${filter.field}"`, 400);
      }
      return { metricKey, fieldKey, min: filter.min, max: filter.max, exclude: filter.exclude };
    }),
  );
}

export async function getPresets(firebaseUid: string): Promise<PresetView[]> {
  const rows = await listPresets(firebaseUid);
  return rows.map(toView);
}

export async function getPresetOrThrow(firebaseUid: string, id: number): Promise<PresetView> {
  const row = await findPreset(firebaseUid, id);
  if (!row) {
    throw new AppError(`Screener preset ${id} not found`, 404);
  }
  return toView(row);
}

/**
 * Creates a preset and auto-assigns it the user's default column preset (creating one from the
 * system default columns — stock price, PER, PBR, dividend yield — if they don't have one yet), so a
 * freshly created preset shows something useful on first run instead of a bare symbol list.
 */
export async function addPreset(
  firebaseUid: string,
  name: string,
  filters: ScreenerFilter[],
): Promise<PresetView> {
  const resolved = await resolveFilters(filters);

  let row: PresetRow;
  try {
    row = await createPreset(firebaseUid, name, resolved);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(`You already have a preset named "${name}"`, 409);
    }
    throw error;
  }

  const defaultColumnPreset = await ensureDefaultColumnPreset(firebaseUid);
  if (defaultColumnPreset) {
    await setLastColumnPreset(firebaseUid, row.id, defaultColumnPreset.id);
    row = { ...row, lastColumnPresetId: defaultColumnPreset.id };
  }

  return toView(row);
}

export async function editPreset(
  firebaseUid: string,
  id: number,
  update: { name?: string; filters?: ScreenerFilter[] },
): Promise<PresetView> {
  const resolvedFilters = update.filters !== undefined ? await resolveFilters(update.filters) : undefined;

  try {
    const row = await updatePreset(firebaseUid, id, { name: update.name, filters: resolvedFilters });
    if (!row) {
      throw new AppError(`Screener preset ${id} not found`, 404);
    }
    return toView(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(`You already have a preset named "${update.name}"`, 409);
    }
    throw error;
  }
}

export async function removePreset(firebaseUid: string, id: number): Promise<void> {
  const deleted = await deletePreset(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Screener preset ${id} not found`, 404);
  }
}

/**
 * Re-runs a saved preset's filters and returns both the filter definition and the matching stocks.
 *
 * Column resolution order: an explicit `columnPresetId` (and when given, it's saved as this preset's
 * new "last viewed with" column preset, i.e. switching columns sticks for next time) → else the column
 * preset this filter combo was last viewed with → else the user's own default column preset → else the
 * hardcoded system default.
 */
export async function runPreset(
  firebaseUid: string,
  id: number,
  columnPresetId?: number,
): Promise<{ preset: PresetView; screener: ScreenerResult; columnPresetId: number | null }> {
  const row = await findPreset(firebaseUid, id);
  if (!row) {
    throw new AppError(`Screener preset ${id} not found`, 404);
  }
  const preset = toView(row);

  const resolved = await resolveScreenerColumns(
    firebaseUid,
    columnPresetId ?? preset.lastColumnPresetId ?? undefined,
  );

  if (columnPresetId !== undefined) {
    await setLastColumnPreset(firebaseUid, id, resolved.columnPresetId ?? columnPresetId);
  }

  const screener = await runScreener(preset.filters, resolved.columns);
  return { preset, screener, columnPresetId: resolved.columnPresetId };
}
