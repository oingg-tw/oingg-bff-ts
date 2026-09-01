import { Prisma } from "@/generated/prisma/client.js";
import { AppError } from "@/shared/errorHandler.js";
import { parseFieldRef, toFieldRefString } from "@/shared/fieldRef.js";
import { findFilterFields } from "@/domains/filterCatalog/index.js";
import type { ScreenerSort } from "@/domains/screener/analysisScreenerClient.js";
import { resolveScreenerColumns } from "@/domains/screener/columnPresets.service.js";
import type { ResolvedScreenerColumns } from "@/domains/screener/columnPresets.service.js";
import type { Pagination } from "@/domains/screener/pagination.js";
import { runScreener } from "@/domains/screener/screener.service.js";
import type { ScreenerFilter, ScreenerResult } from "@/domains/screener/screener.types.js";
import {
  createPreset,
  deletePreset,
  findPreset,
  listPresets,
  setLastColumnPreset,
  updatePreset,
  type PresetFilterInput,
  type PresetRow,
} from "@/domains/screener/screenerPresets.repository.js";

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
  id: string;
  name: string;
  filters: PresetFilterView[];
  lastColumnPresetId: string | null;
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

export async function getPresetOrThrow(firebaseUid: string, id: string): Promise<PresetView> {
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

/** Base name for a newly created preset — the frontend creates first, then renames via PATCH. */
const DEFAULT_PRESET_NAME = "未命名";

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
 * resolveScreenerColumns's live default-resolution every time it's run (currently: no columns), so
 * changing that behavior in code updates every such user at once. Materializing a per-user row here
 * instead would freeze in whatever the default was at creation time — already-created rows wouldn't
 * pick up a later change, defeating the point of a single shared default.
 *
 * `filters` defaults to ROE > 30 (DEFAULT_PRESET_FILTERS) when the caller passes an empty array,
 * rather than saving an empty preset.
 *
 * There's no `name` input — the frontend creates first and renames via PATCH afterwards — so every
 * new preset starts from DEFAULT_PRESET_NAME ("未命名"), falling back to "未命名 2", "未命名 3", etc.
 * (pickAvailableName) the same way a file explorer names a new file, never erroring on a collision.
 * The isUniqueViolation retry loop only guards the race where another request grabs the picked name
 * between the check and the insert.
 */
export async function addPreset(firebaseUid: string, filters: ScreenerFilter[]): Promise<PresetView> {
  const resolved = await resolveFilters(filters.length > 0 ? filters : DEFAULT_PRESET_FILTERS);
  return createPresetWithAvailableName(firebaseUid, DEFAULT_PRESET_NAME, resolved);
}

/**
 * Same name-collision handling as addPreset (pickAvailableName + retry on a unique-constraint race),
 * but starting from a caller-chosen base name instead of the hardcoded "未命名" — used when cloning a
 * PresetTemplate into a user's own presets (see presetTemplates.service.ts), where the sensible starting
 * name is the template's own name, not "未命名".
 */
export async function addPresetWithName(
  firebaseUid: string,
  name: string,
  filters: ScreenerFilter[],
): Promise<PresetView> {
  const resolved = await resolveFilters(filters);
  return createPresetWithAvailableName(firebaseUid, name, resolved);
}

async function createPresetWithAvailableName(
  firebaseUid: string,
  baseName: string,
  resolvedFilters: PresetFilterInput[],
): Promise<PresetView> {
  for (let attempt = 0; attempt < MAX_NAME_SUFFIX_ATTEMPTS; attempt++) {
    const candidateName = await pickAvailableName(firebaseUid, baseName);
    try {
      const row = await createPreset(firebaseUid, candidateName, resolvedFilters);
      return toView(row);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }
  throw new AppError(`Could not find an available name for "${baseName}"`, 409);
}

export async function editPreset(
  firebaseUid: string,
  id: string,
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

export async function removePreset(firebaseUid: string, id: string): Promise<void> {
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
 *
 * Perf (2026-09-01): when `columnPresetId` is given explicitly, resolving it doesn't need
 * `preset.lastColumnPresetId` at all — findPreset and resolveScreenerColumns are independent lookups
 * against the same remote DB in that case, so they run concurrently instead of paying two sequential
 * round trips. Only the no-explicit-columnPresetId path genuinely needs findPreset's result first.
 * setLastColumnPreset is also now skipped when nothing actually changed — every "same columnPresetId as
 * last time" call (e.g. paging through the same view) used to fire a write that changed nothing.
 */
export async function runPreset(
  firebaseUid: string,
  id: string,
  pagination: Pagination,
  columnPresetId?: string,
  sort?: ScreenerSort,
): Promise<{ preset: PresetView; screener: ScreenerResult; columnPresetId: string | null }> {
  let row: PresetRow | null;
  let resolved: ResolvedScreenerColumns;

  if (columnPresetId !== undefined) {
    [row, resolved] = await Promise.all([
      findPreset(firebaseUid, id),
      resolveScreenerColumns(firebaseUid, columnPresetId),
    ]);
  } else {
    row = await findPreset(firebaseUid, id);
    resolved = await resolveScreenerColumns(firebaseUid, row?.lastColumnPresetId ?? undefined);
  }

  if (!row) {
    throw new AppError(`Screener preset ${id} not found`, 404);
  }
  const preset = toView(row);

  if (columnPresetId !== undefined && resolved.columnPresetId !== preset.lastColumnPresetId) {
    await setLastColumnPreset(firebaseUid, id, resolved.columnPresetId ?? columnPresetId);
  }

  const screener = await runScreener(preset.filters, resolved.columns, pagination, sort);
  return { preset, screener, columnPresetId: resolved.columnPresetId };
}
