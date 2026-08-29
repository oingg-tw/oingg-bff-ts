import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../shared/errorHandler.js";
import { parseFieldRef, toFieldRefString } from "../../shared/fieldRef.js";
import { findFilterFields } from "../filterCatalog/index.js";
import { resolveScreenerColumns } from "./columnPresets.service.js";
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

/**
 * Validates every filter's field exists in the catalog and resolves it to (metricKey, fieldKey).
 *
 * Looks all fields up in a single batched query rather than one query per filter — the app DB is a
 * remote Neon Postgres, so a preset with several filters used to pay one full network round trip per
 * filter just for validation.
 */
async function resolveFilters(filters: ScreenerFilter[]): Promise<PresetFilterInput[]> {
  const refs = filters.map((filter) => parseFieldRef(filter.field));
  const found = await findFilterFields(refs);
  const foundKeys = new Set(found.map((f) => toFieldRefString(f.metricKey, f.fieldKey)));

  return filters.map((filter, i) => {
    const { metricKey, fieldKey } = refs[i]!;
    if (!foundKeys.has(toFieldRefString(metricKey, fieldKey))) {
      throw new AppError(`Unknown filter field "${filter.field}"`, 400);
    }
    return { metricKey, fieldKey, min: filter.min, max: filter.max, exclude: filter.exclude };
  });
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

/** Out-of-the-box condition for a preset created with no filters — ROE > 30. */
const DEFAULT_PRESET_FILTERS: ScreenerFilter[] = [
  { field: "roe.roeTtmPct", min: 30, max: null, exclude: false },
];

const MAX_NAME_SUFFIX_ATTEMPTS = 1000;

/**
 * Picks a free name for a new preset the same way a file explorer names a new file: `name` itself if
 * nobody's using it yet, else `name 2`, `name 3`, ... — never an error just because `name` collides.
 */
async function pickAvailableName(firebaseUid: string, name: string): Promise<string> {
  const existing = new Set((await listPresets(firebaseUid)).map((row) => row.name));
  if (!existing.has(name)) {
    return name;
  }
  for (let suffix = 2; suffix < MAX_NAME_SUFFIX_ATTEMPTS; suffix++) {
    const candidate = `${name} ${suffix}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  throw new AppError(`Could not find an available name for "${name}"`, 409);
}

/**
 * Creates a preset. `lastColumnPresetId` starts out null — deliberately not auto-assigned to a
 * materialized ColumnPreset row. Leaving it null means a fresh preset falls through to
 * resolveScreenerColumns's live SYSTEM_DEFAULT_COLUMNS fallback every time it's run, so changing that
 * constant in code updates the default for every such user at once. Materializing a per-user row here
 * instead would freeze in whatever the default was at creation time — already-created rows wouldn't
 * pick up a later change to the constant, defeating the point of a single shared default.
 *
 * `filters` defaults to ROE > 30 (DEFAULT_PRESET_FILTERS) when the caller passes an empty array,
 * rather than saving an empty preset.
 *
 * `name` never causes a conflict error: if it's taken, this falls back to `name 2`, `name 3`, etc.
 * (pickAvailableName), same as how a file explorer names a new file. The isUniqueViolation retry loop
 * only guards the race where another request grabs the picked name between the check and the insert.
 */
export async function addPreset(
  firebaseUid: string,
  name: string,
  filters: ScreenerFilter[],
): Promise<PresetView> {
  const resolved = await resolveFilters(filters.length > 0 ? filters : DEFAULT_PRESET_FILTERS);

  for (let attempt = 0; attempt < MAX_NAME_SUFFIX_ATTEMPTS; attempt++) {
    const candidateName = await pickAvailableName(firebaseUid, name);
    try {
      const row = await createPreset(firebaseUid, candidateName, resolved);
      return toView(row);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }
  throw new AppError(`Could not find an available name for "${name}"`, 409);
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
