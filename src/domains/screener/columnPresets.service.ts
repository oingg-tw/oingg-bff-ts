import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../shared/errorHandler.js";
import { resolveColumnFields } from "./columnField.js";
import {
  createColumnPreset,
  deleteColumnPreset,
  findColumnPreset,
  findDefaultColumnPreset,
  listColumnPresets,
  updateColumnPreset,
  type ColumnPresetRow,
} from "./columnPresets.repository.js";
import type { ScreenerColumnRef } from "./screener.types.js";

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
  id: number;
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

export async function getColumnPresetOrThrow(firebaseUid: string, id: number): Promise<ColumnPresetView> {
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

export async function editColumnPreset(
  firebaseUid: string,
  id: number,
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

export async function removeColumnPreset(firebaseUid: string, id: number): Promise<void> {
  const deleted = await deleteColumnPreset(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Column preset ${id} not found`, 404);
  }
}

/**
 * Out-of-the-box columns for users who haven't set up any column preset yet — a plain code constant,
 * deliberately not materialized into a per-user DB row (see addPreset's docstring for why). Changing
 * this array changes the default for every such user immediately, no data migration needed.
 */
export const SYSTEM_DEFAULT_COLUMNS: ScreenerColumnRef[] = [
  { field: "stock.price" },
  { field: "marketRatios.peRatio" },
  { field: "marketRatios.pbRatio" },
  { field: "marketRatios.dividendYieldPct" },
];

export interface ResolvedScreenerColumns {
  columnPresetId: number | null;
  columns: ScreenerColumnRef[];
}

/**
 * Resolves which columns a screener call should display: an explicit columnPresetId (404 if it
 * doesn't exist/isn't the caller's), else the user's own `isDefault` preset, else the hardcoded
 * system default. `columnPresetId: null` in the result means "no real preset's columns are being
 * shown" (system default) — including when a resolved preset exists but has zero columns saved:
 * matching stocks must never come back as bare symbols with no field data attached, so an empty
 * preset (explicit, default, or "last used") falls through to the system default same as no preset
 * at all, rather than being honored as "show nothing".
 */
export async function resolveScreenerColumns(
  firebaseUid: string,
  columnPresetId?: number,
): Promise<ResolvedScreenerColumns> {
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

  return { columnPresetId: null, columns: SYSTEM_DEFAULT_COLUMNS };
}
