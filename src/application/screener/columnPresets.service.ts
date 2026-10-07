import { AppError, REORDER_MISMATCH_CODE } from "@/domain/appError.js";
import type { ScreenerColumnRef } from "@/domain/screenerCriteria.js";
import { logger } from "@/shared/logger.js";
import type { AppDeps } from "@/application/deps.js";
import { resolveColumnFields } from "@/application/screener/columnField.js";
import type { ColumnPresetRow } from "@/application/screener/columnPresets.types.js";

/**
 * Three ports, not just `columnPresets`: resolveScreenerColumns falls back to the curated
 * ColumnPresetTemplate when the caller has no preset of their own, so "which columns do I show" genuinely
 * spans those two tables, and every view built here resolves its fields' display names against the
 * synced metric catalog (see resolveColumnFields). Everything else only touches `columnPresets`.
 */
export type ColumnPresetsDeps = Pick<AppDeps, "columnPresets" | "columnPresetTemplates" | "metricCatalog">;

export interface ColumnPresetColumnView {
  field: string;
  metricName: string;
  fieldName: string;
}

export interface ColumnPresetView {
  id: string;
  name: string;
  isDefault: boolean;
  columns: ColumnPresetColumnView[];
  createdAt: string;
  updatedAt: string;
}

function buildView(
  row: ColumnPresetRow,
  infoByField: Map<string, { metricName: string; fieldName: string } | null>,
): ColumnPresetView {
  const columns = row.columns.map((field): ColumnPresetColumnView => {
    const info = infoByField.get(field);
    return { field, metricName: info?.metricName ?? field, fieldName: info?.fieldName ?? field };
  });
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    columns,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function toView(row: ColumnPresetRow, deps: ColumnPresetsDeps): Promise<ColumnPresetView> {
  const infoByField = await resolveColumnFields(row.columns, deps);
  return buildView(row, infoByField);
}

async function validateFields(fields: string[], deps: ColumnPresetsDeps): Promise<void> {
  const infoByField = await resolveColumnFields(fields, deps);
  for (const field of fields) {
    if (!infoByField.get(field)) {
      throw new AppError(`Unknown column field "${field}"`, 400);
    }
  }
}

/**
 * Regression-shaped perf fix (2026-09-01): used to call toView() per row via Promise.all, each doing its
 * own resolveColumnFields round trip — N presets meant N concurrent-but-separate remote DB queries
 * instead of one. Batches every preset's columns into a single resolveColumnFields call up front, same
 * "one round trip, not one per item" rule already applied to findMetricFields/findMetricField elsewhere
 * in this codebase.
 */
export async function getColumnPresets(firebaseUid: string, deps: ColumnPresetsDeps): Promise<ColumnPresetView[]> {
  const rows = await deps.columnPresets.list(firebaseUid);
  const allFields = [...new Set(rows.flatMap((row) => row.columns))];
  const infoByField = await resolveColumnFields(allFields, deps);
  return rows.map((row) => buildView(row, infoByField));
}

export async function getColumnPresetOrThrow(
  firebaseUid: string,
  id: string,
  deps: ColumnPresetsDeps,
): Promise<ColumnPresetView> {
  const row = await deps.columnPresets.find(firebaseUid, id);
  if (!row) {
    throw new AppError(`Column preset ${id} not found`, 404);
  }
  return toView(row, deps);
}

/**
 * The duplicate case arrives as a value from the port rather than as a thrown Prisma error. Before the
 * ports refactor this function caught `Prisma.PrismaClientKnownRequestError` and compared `error.code`
 * to "P2002", which quietly tied the 409 to one specific database driver.
 */
export async function addColumnPreset(
  firebaseUid: string,
  name: string,
  columns: string[],
  isDefault: boolean,
  deps: ColumnPresetsDeps,
): Promise<ColumnPresetView> {
  await validateFields(columns, deps);

  const result = await deps.columnPresets.create(firebaseUid, name, columns, isDefault);
  if (!result.ok) {
    throw new AppError(`You already have a column preset named "${name}"`, 409);
  }
  return toView(result.row, deps);
}

const MAX_NAME_SUFFIX_ATTEMPTS = 1000;

/** Picks a free name the same way a file explorer names a new file: `name` itself, else `name 2`, `name 3`, ... */
async function pickAvailableName(firebaseUid: string, name: string, deps: ColumnPresetsDeps): Promise<string> {
  const existing = new Set((await deps.columnPresets.list(firebaseUid)).map((row) => row.name));
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
 * Same name-collision handling as addPresetWithName (screenerPresets.service.ts) — used to clone a
 * ColumnPresetTemplate into a user's own presets (see columnPresetTemplates.service.ts's
 * applyColumnPresetTemplate), where the sensible starting name is the template's own name.
 *
 * Note the deliberate difference from addColumnPreset above: the same `{ ok: false, reason: "duplicate" }`
 * from the port means "retry under another name" here and "409 back to the caller" there. Applying the
 * same template twice must produce a second, separately-named preset, not an error.
 */
export async function addColumnPresetWithName(
  firebaseUid: string,
  name: string,
  columns: string[],
  deps: ColumnPresetsDeps,
): Promise<ColumnPresetView> {
  await validateFields(columns, deps);

  for (let attempt = 0; attempt < MAX_NAME_SUFFIX_ATTEMPTS; attempt++) {
    const candidateName = await pickAvailableName(firebaseUid, name, deps);
    const result = await deps.columnPresets.create(firebaseUid, candidateName, columns, false);
    if (result.ok) {
      return toView(result.row, deps);
    }
  }
  throw new AppError(`Could not find an available name for "${name}"`, 409);
}

export async function editColumnPreset(
  firebaseUid: string,
  id: string,
  update: { name?: string; columns?: string[]; isDefault?: boolean },
  deps: ColumnPresetsDeps,
): Promise<ColumnPresetView> {
  if (update.columns !== undefined) {
    await validateFields(update.columns, deps);
  }

  const result = await deps.columnPresets.update(firebaseUid, id, update);
  if (!result.ok) {
    if (result.reason === "duplicate") {
      throw new AppError(`You already have a column preset named "${update.name}"`, 409);
    }
    throw new AppError(`Column preset ${id} not found`, 404);
  }
  return toView(result.row, deps);
}

export async function removeColumnPreset(firebaseUid: string, id: string, deps: ColumnPresetsDeps): Promise<void> {
  const deleted = await deps.columnPresets.remove(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Column preset ${id} not found`, 404);
  }
}

/**
 * Persists a full drag-to-reorder of the caller's own column-preset tabs. `orderedIds` must be exactly
 * this user's current set of preset ids (no add/remove here, same "full replacement" rule PATCH's
 * `columns` already uses) — a 400 if it doesn't match, rather than silently reordering a subset.
 */
export async function reorderColumnPresetsForUser(
  firebaseUid: string,
  orderedIds: string[],
  deps: ColumnPresetsDeps,
): Promise<ColumnPresetView[]> {
  const rows = await deps.columnPresets.reorder(firebaseUid, orderedIds);
  if (!rows) {
    throw new AppError("`ids` must be exactly this user's current set of column preset ids, in the new order", 400, undefined, REORDER_MISMATCH_CODE);
  }

  const allFields = [...new Set(rows.flatMap((row) => row.columns))];
  const infoByField = await resolveColumnFields(allFields, deps);
  return rows.map((row) => buildView(row, infoByField));
}

export interface ResolvedScreenerColumns {
  columnPresetId: string | null;
  columns: ScreenerColumnRef[];
}

/**
 * Falls back to the curated "overview" ColumnPresetTemplate (see ColumnPresetTemplatesPort.findDefault)
 * whenever there's no real user-owned preset's columns to show — the intended replacement for the old
 * hardcoded SYSTEM_DEFAULT_COLUMNS array, curated in the DB instead of frozen in this service's code.
 * Empty columns only if even that's missing (seed hasn't run yet / DB row was deleted).
 *
 * Filters the template's fieldKeys down to ones that actually resolve against the current filter
 * catalog, dropping any that don't (logged as a warning) instead of passing them straight through.
 * Found live (2026-09-08): analysis-ts's `/filters` response has `categories` (the queryable catalog)
 * and `columnPresets` (curated field groupings, this template's source at the time) maintained somewhat
 * independently — the "overview" template kept referencing fields (`roe.roeTtmPct`,
 * `debtRatio.debtRatioPct`) that had already been dropped from `categories`, which made every screener
 * call without an explicit columnPresetId fail 100% of the time with an "unknown filter field" error
 * unrelated to anything the caller actually asked for. Degrading to fewer default columns is far better
 * than hard-failing the entire request over a stale field in an upstream curated list.
 */
async function resolveDefaultColumns(deps: ColumnPresetsDeps): Promise<ScreenerColumnRef[]> {
  const template = await deps.columnPresetTemplates.findDefault();
  if (!template) {
    return [];
  }

  const resolved = await resolveColumnFields(template.fieldKeys, deps);
  const validFields = template.fieldKeys.filter((field) => resolved.get(field) !== null);
  const droppedFields = template.fieldKeys.filter((field) => resolved.get(field) === null);
  if (droppedFields.length > 0) {
    logger.warn(
      { template: template.key, droppedFields },
      "Default column preset template references fields not in the current filter catalog — dropping them",
    );
  }

  return validFields.map((field) => ({ field }));
}

/**
 * Resolves which columns a screener call should display, in priority order: an explicit columnPresetId
 * (404 if it doesn't exist/isn't the caller's), else the user's own `isDefault` preset, else the curated
 * "overview" ColumnPresetTemplate (see resolveDefaultColumns) — the screener's own default column set
 * until the caller explicitly changes or customizes it. `columnPresetId: null` in the result means "no
 * real user-owned preset's columns are being shown" — true both when falling back to the curated
 * template and when a resolved user preset (explicit or default) exists but has zero columns saved.
 *
 * `firebaseUid` is undefined for anonymous screener calls (guests aren't signed in, so they can't own a
 * preset) — always the curated default in that case, regardless of columnPresetId, since a column
 * preset id can only ever resolve for the account that owns it.
 */
export async function resolveScreenerColumns(
  firebaseUid: string | undefined,
  columnPresetId: string | undefined,
  deps: ColumnPresetsDeps,
): Promise<ResolvedScreenerColumns> {
  if (!firebaseUid) {
    return { columnPresetId: null, columns: await resolveDefaultColumns(deps) };
  }

  if (columnPresetId !== undefined) {
    const preset = await deps.columnPresets.find(firebaseUid, columnPresetId);
    if (!preset) {
      throw new AppError(`Column preset ${columnPresetId} not found`, 404);
    }
    if (preset.columns.length > 0) {
      return { columnPresetId: preset.id, columns: preset.columns.map((field) => ({ field })) };
    }
  } else {
    const defaultPreset = await deps.columnPresets.findDefault(firebaseUid);
    if (defaultPreset && defaultPreset.columns.length > 0) {
      return { columnPresetId: defaultPreset.id, columns: defaultPreset.columns.map((field) => ({ field })) };
    }
  }

  return { columnPresetId: null, columns: await resolveDefaultColumns(deps) };
}
