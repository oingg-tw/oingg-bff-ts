import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../shared/errorHandler.js";
import { resolveColumnField } from "./columnField.js";
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
  const columns = await Promise.all(
    row.columns.map(async (field): Promise<ColumnPresetColumnView> => {
      const info = await resolveColumnField(field);
      return { field, metricName: info?.metricName ?? field, fieldName: info?.fieldName ?? field };
    }),
  );
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
  for (const field of fields) {
    const info = await resolveColumnField(field);
    if (!info) {
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

/** Out-of-the-box columns for users who haven't set up any column preset yet. */
export const SYSTEM_DEFAULT_COLUMNS: ScreenerColumnRef[] = [
  { field: "stock.price" },
  { field: "marketRatios.peRatio" },
  { field: "marketRatios.pbRatio" },
  { field: "marketRatios.dividendYieldPct" },
];

const DEFAULT_COLUMN_PRESET_NAME = "常用欄位";

/**
 * Ensures the user has a default ColumnPreset, creating one from SYSTEM_DEFAULT_COLUMNS (stock price,
 * PER, PBR, dividend yield) if they don't have one yet. Called when a user creates their first
 * ScreenerPreset, so it starts out already showing something useful instead of a bare symbol list.
 * Returns null only if auto-creation itself failed (e.g. a same-named non-default preset already
 * exists) — callers should treat that as "couldn't set one up automatically", not fail the caller's
 * own operation over a side effect.
 */
export async function ensureDefaultColumnPreset(firebaseUid: string): Promise<ColumnPresetView | null> {
  const existing = await findDefaultColumnPreset(firebaseUid);
  if (existing) {
    return toView(existing);
  }

  try {
    return await addColumnPreset(
      firebaseUid,
      DEFAULT_COLUMN_PRESET_NAME,
      SYSTEM_DEFAULT_COLUMNS.map((c) => c.field),
      true,
    );
  } catch (error) {
    if (error instanceof AppError) {
      return null;
    }
    throw error;
  }
}

export interface ResolvedScreenerColumns {
  columnPresetId: number | null;
  columns: ScreenerColumnRef[];
}

/**
 * Resolves which columns a screener call should display: an explicit columnPresetId (404 if it
 * doesn't exist/isn't the caller's), else the user's own `isDefault` preset, else the hardcoded
 * system default. `columnPresetId: null` in the result means "no real preset was used" (system default).
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
    return { columnPresetId: preset.id, columns: preset.columns.map((field) => ({ field })) };
  }

  const defaultPreset = await findDefaultColumnPreset(firebaseUid);
  if (defaultPreset) {
    return { columnPresetId: defaultPreset.id, columns: defaultPreset.columns.map((field) => ({ field })) };
  }

  return { columnPresetId: null, columns: SYSTEM_DEFAULT_COLUMNS };
}
