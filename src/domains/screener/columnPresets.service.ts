import { Prisma } from "@/generated/prisma/client.js";
import { AppError } from "@/shared/errorHandler.js";
import { findDefaultColumnPresetTemplate } from "@/domains/columnPresetTemplates/columnPresetTemplates.repository.js";
import { resolveColumnFields } from "@/domains/screener/columnField.js";
import {
  createColumnPreset,
  deleteColumnPreset,
  findColumnPreset,
  findDefaultColumnPreset,
  listColumnPresets,
  updateColumnPreset,
  type ColumnPresetRow,
} from "@/domains/screener/columnPresets.repository.js";
import type { ScreenerColumnRef } from "@/domains/screener/screener.types.js";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION;
}

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

async function toView(row: ColumnPresetRow): Promise<ColumnPresetView> {
  const infoByField = await resolveColumnFields(row.columns);
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

async function validateFields(fields: string[]): Promise<void> {
  const infoByField = await resolveColumnFields(fields);
  for (const field of fields) {
    if (!infoByField.get(field)) {
      throw new AppError(`Unknown column field "${field}"`, 400);
    }
  }
}

export async function getColumnPresets(firebaseUid: string): Promise<ColumnPresetView[]> {
  const rows = await listColumnPresets(firebaseUid);
  return Promise.all(rows.map(toView));
}

export async function getColumnPresetOrThrow(firebaseUid: string, id: string): Promise<ColumnPresetView> {
  const row = await findColumnPreset(firebaseUid, id);
  if (!row) {
    throw new AppError(`Column preset ${id} not found`, 404);
  }
  return toView(row);
}

export async function addColumnPreset(
  firebaseUid: string,
  name: string,
  columns: string[],
  isDefault: boolean,
): Promise<ColumnPresetView> {
  await validateFields(columns);

  try {
    const row = await createColumnPreset(firebaseUid, name, columns, isDefault);
    return toView(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(`You already have a column preset named "${name}"`, 409);
    }
    throw error;
  }
}

const MAX_NAME_SUFFIX_ATTEMPTS = 1000;

/** Picks a free name the same way a file explorer names a new file: `name` itself, else `name 2`, `name 3`, ... */
async function pickAvailableName(firebaseUid: string, name: string): Promise<string> {
  const existing = new Set((await listColumnPresets(firebaseUid)).map((row) => row.name));
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
 */
export async function addColumnPresetWithName(
  firebaseUid: string,
  name: string,
  columns: string[],
): Promise<ColumnPresetView> {
  await validateFields(columns);

  for (let attempt = 0; attempt < MAX_NAME_SUFFIX_ATTEMPTS; attempt++) {
    const candidateName = await pickAvailableName(firebaseUid, name);
    try {
      const row = await createColumnPreset(firebaseUid, candidateName, columns, false);
      return toView(row);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }
  throw new AppError(`Could not find an available name for "${name}"`, 409);
}

export async function editColumnPreset(
  firebaseUid: string,
  id: string,
  update: { name?: string; columns?: string[]; isDefault?: boolean },
): Promise<ColumnPresetView> {
  if (update.columns !== undefined) {
    await validateFields(update.columns);
  }

  try {
    const row = await updateColumnPreset(firebaseUid, id, update);
    if (!row) {
      throw new AppError(`Column preset ${id} not found`, 404);
    }
    return toView(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(`You already have a column preset named "${update.name}"`, 409);
    }
    throw error;
  }
}

export async function removeColumnPreset(firebaseUid: string, id: string): Promise<void> {
  const deleted = await deleteColumnPreset(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Column preset ${id} not found`, 404);
  }
}

export interface ResolvedScreenerColumns {
  columnPresetId: string | null;
  columns: ScreenerColumnRef[];
}

/**
 * Falls back to analysis-ts's curated "overview" ColumnPresetTemplate (see
 * columnPresetTemplates.repository.ts's findDefaultColumnPresetTemplate) whenever there's no real
 * user-owned preset's columns to show — the intended replacement for the old hardcoded
 * SYSTEM_DEFAULT_COLUMNS array, kept in sync from analysis-ts instead of frozen in this service's code.
 * Empty columns only if even that's missing (sync hasn't run yet / DB row was deleted).
 */
async function resolveDefaultColumns(): Promise<ScreenerColumnRef[]> {
  const template = await findDefaultColumnPresetTemplate();
  return template ? template.fieldKeys.map((field) => ({ field })) : [];
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
  columnPresetId?: string,
): Promise<ResolvedScreenerColumns> {
  if (!firebaseUid) {
    return { columnPresetId: null, columns: await resolveDefaultColumns() };
  }

  if (columnPresetId !== undefined) {
    const preset = await findColumnPreset(firebaseUid, columnPresetId);
    if (!preset) {
      throw new AppError(`Column preset ${columnPresetId} not found`, 404);
    }
    if (preset.columns.length > 0) {
      return { columnPresetId: preset.id, columns: preset.columns.map((field) => ({ field })) };
    }
  } else {
    const defaultPreset = await findDefaultColumnPreset(firebaseUid);
    if (defaultPreset && defaultPreset.columns.length > 0) {
      return { columnPresetId: defaultPreset.id, columns: defaultPreset.columns.map((field) => ({ field })) };
    }
  }

  return { columnPresetId: null, columns: await resolveDefaultColumns() };
}
