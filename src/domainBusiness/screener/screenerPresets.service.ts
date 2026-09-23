import { Prisma } from "@/generated/prisma/client.js";
import { AppError } from "@/http/errorHandler.js";
import { parseFieldRef, toFieldRefString } from "@/shared/fieldRef.js";
import { findMetricFields } from "@/domainBusiness/metricCatalog/index.js";
import type { ScreenerFilter } from "@/domainBff/screener/screener.types.js";
import {
  createPreset,
  deletePreset,
  findPreset,
  listPresets,
  reorderPresets,
  setLastColumnPreset,
  updatePreset,
  type PresetFilterInput,
  type PresetRow,
} from "@/domainBusiness/screener/screenerPresets.repository.js";

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
  sectorCodes: string[];
  excludeSectorCodes: string[];
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
    sectorCodes: row.sectorCodes,
    excludeSectorCodes: row.excludeSectorCodes,
    lastColumnPresetId: row.lastColumnPresetId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Trims and drops empty strings — no catalog to validate against (analysis-ts is sole authority, see schema.prisma). */
function normalizeSectorCodes(sectorCodes: string[] | undefined): string[] | undefined {
  if (sectorCodes === undefined) {
    return undefined;
  }
  return sectorCodes.map((code) => code.trim()).filter((code) => code.length > 0);
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
  const found = await findMetricFields(refs);
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

/**
 * Out-of-the-box condition for a preset created with no filters — ROE (TTM) > 30. Field name updated
 * 2026-09-08 for analysis-ts's pitMetrics rebuild — the old "roe.roeTtmPct" metricKey.fieldKey addressing
 * no longer exists, replaced by "<metricCode>.<basis>" (confirmed live: "roe" allows Q/Q_ANN/TTM bases).
 */
const DEFAULT_PRESET_FILTERS: ScreenerFilter[] = [{ field: "roe.TTM", min: 30, max: null, exclude: false }];

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
export async function addPreset(
  firebaseUid: string,
  filters: ScreenerFilter[],
  sectorCodes: string[] = [],
  excludeSectorCodes: string[] = [],
): Promise<PresetView> {
  const resolved = await resolveFilters(filters.length > 0 ? filters : DEFAULT_PRESET_FILTERS);
  return createPresetWithAvailableName(
    firebaseUid,
    DEFAULT_PRESET_NAME,
    resolved,
    normalizeSectorCodes(sectorCodes) ?? [],
    normalizeSectorCodes(excludeSectorCodes) ?? [],
  );
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
  return createPresetWithAvailableName(firebaseUid, name, resolved, []);
}

async function createPresetWithAvailableName(
  firebaseUid: string,
  baseName: string,
  resolvedFilters: PresetFilterInput[],
  sectorCodes: string[],
  excludeSectorCodes: string[] = [],
): Promise<PresetView> {
  for (let attempt = 0; attempt < MAX_NAME_SUFFIX_ATTEMPTS; attempt++) {
    const candidateName = await pickAvailableName(firebaseUid, baseName);
    try {
      const row = await createPreset(firebaseUid, candidateName, resolvedFilters, sectorCodes, excludeSectorCodes);
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
  update: { name?: string; filters?: ScreenerFilter[]; sectorCodes?: string[]; excludeSectorCodes?: string[] },
): Promise<PresetView> {
  const resolvedFilters = update.filters !== undefined ? await resolveFilters(update.filters) : undefined;

  const sectorCodes = normalizeSectorCodes(update.sectorCodes);
  const excludeSectorCodes = normalizeSectorCodes(update.excludeSectorCodes);
  // A PATCH only sends the field(s) actually changing — the route schema's mutual-exclusivity refine only
  // sees this request's own body, not the row's existing state. Setting one of these to a non-empty value
  // implicitly clears the other (rather than requiring the caller to explicitly zero it out every time),
  // so a partial update can never leave both non-empty at once — same "these two are one choice" intent
  // POST /screener enforces up front, just applied across a PATCH's partial-update semantics instead.
  const clearSectorCodes = excludeSectorCodes !== undefined && excludeSectorCodes.length > 0;
  const clearExcludeSectorCodes = sectorCodes !== undefined && sectorCodes.length > 0;

  try {
    const row = await updatePreset(firebaseUid, id, {
      name: update.name,
      filters: resolvedFilters,
      sectorCodes: clearSectorCodes ? [] : sectorCodes,
      excludeSectorCodes: clearExcludeSectorCodes ? [] : excludeSectorCodes,
    });
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
 * Persists a full drag-to-reorder of the caller's own filter-preset tabs. `orderedIds` must be exactly
 * this user's current set of preset ids — same "full replacement, 400 on mismatch" rule as
 * columnPresets.service.ts's reorderColumnPresetsForUser.
 */
export async function reorderPresetsForUser(firebaseUid: string, orderedIds: string[]): Promise<PresetView[]> {
  const rows = await reorderPresets(firebaseUid, orderedIds);
  if (!rows) {
    throw new AppError("`ids` must be exactly this user's current set of screener preset ids, in the new order", 400);
  }
  return rows.map(toView);
}

/**
 * Records which column preset a saved filter preset was last run with — called from the bff layer's
 * runPreset orchestration (see screener/runPreset.ts) after it resolves columns via analysisScreenerClient
 * and this domain's own resolveScreenerColumns. Exported as a service-level wrapper (rather than letting
 * the bff layer reach into screenerPresets.repository.ts directly) so this domain's persistence details
 * stay behind its own service boundary.
 */
export async function updateLastColumnPreset(
  firebaseUid: string,
  id: string,
  columnPresetId: string,
): Promise<void> {
  await setLastColumnPreset(firebaseUid, id, columnPresetId);
}
