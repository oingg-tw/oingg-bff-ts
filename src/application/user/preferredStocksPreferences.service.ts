import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import type {
  PreferredStocksColumnPreset,
  PreferredStocksPreferences,
} from "@/application/user/preferredStocksPreferences.types.js";

export type PreferredStocksPreferencesDeps = Pick<AppDeps, "userPreferences">;

const VALID_COLUMN_PRESETS: PreferredStocksColumnPreset[] = ["ALL", "CONTRACT_TERMS", "VALUATION", "CALL_RISK"];

/**
 * `columnPresetId`/`columnOrder` both null means "no preference saved yet" — the frontend applies its
 * own local default for each, same reasoning as getStockDetailPreferences/getDashboardCardSettings.
 */
export async function getPreferredStocksPreferences(
  firebaseUid: string,
  deps: PreferredStocksPreferencesDeps,
): Promise<PreferredStocksPreferences> {
  const row = await deps.userPreferences.getPreferredStocksPreferences(firebaseUid);
  return { columnPresetId: row?.columnPresetId ?? null, columnOrder: row?.columnOrder ?? null };
}

function assertValidColumnPresetId(columnPresetId: unknown): asserts columnPresetId is PreferredStocksColumnPreset {
  if (!VALID_COLUMN_PRESETS.includes(columnPresetId as PreferredStocksColumnPreset)) {
    throw new AppError(`"columnPresetId" must be one of ${VALID_COLUMN_PRESETS.join(", ")}`, 400);
  }
}

function assertValidColumnOrder(columnOrder: unknown): asserts columnOrder is string[] {
  if (!Array.isArray(columnOrder) || !columnOrder.every((id) => typeof id === "string")) {
    throw new AppError('"columnOrder" must be an array of strings', 400);
  }
}

/**
 * Full overwrite of both fields together, never a partial update — same pattern as
 * updateStockDetailPreferences (web-nuxt's settings UI always saves both at once). Column ids aren't
 * validated against a known list, same reasoning as updateDashboardCardSettings.
 */
export async function updatePreferredStocksPreferences(
  firebaseUid: string,
  columnPresetId: unknown,
  columnOrder: unknown,
  deps: PreferredStocksPreferencesDeps,
): Promise<PreferredStocksPreferences> {
  assertValidColumnPresetId(columnPresetId);
  assertValidColumnOrder(columnOrder);
  const row = await deps.userPreferences.savePreferredStocksPreferences(firebaseUid, columnPresetId, columnOrder);
  return { columnPresetId: row.columnPresetId, columnOrder: row.columnOrder };
}
