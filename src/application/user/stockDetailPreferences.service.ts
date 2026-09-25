import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import type { StockDetailPageMode, StockDetailPreferences } from "@/application/user/stockDetailPreferences.types.js";

export type StockDetailPreferencesDeps = Pick<AppDeps, "userPreferences">;

const VALID_MODES: StockDetailPageMode[] = ["CARD", "ACCOUNTING"];

/**
 * `mode`/`visibleCardIds` both null means "no preference saved yet" — the frontend applies its own
 * local default for each, same reasoning as getDashboardCardSettings.
 */
export async function getStockDetailPreferences(
  firebaseUid: string,
  deps: StockDetailPreferencesDeps,
): Promise<StockDetailPreferences> {
  const row = await deps.userPreferences.getStockDetailPreferences(firebaseUid);
  return {
    mode: row?.mode ?? null,
    visibleCardIds: row?.visibleCardIds ?? null,
    // row 存在但這一欄是 null 的情況真實存在（2026-09-25 之前存過偏好的使用者），所以不能只看 row。
    pinnedMetricSlugs: row?.pinnedMetricSlugs ?? null,
  };
}

function assertValidMode(mode: unknown): asserts mode is StockDetailPageMode {
  if (!VALID_MODES.includes(mode as StockDetailPageMode)) {
    throw new AppError(`"mode" must be one of ${VALID_MODES.join(", ")}`, 400);
  }
}

function assertValidVisibleCardIds(visibleCardIds: unknown): asserts visibleCardIds is string[] {
  if (!Array.isArray(visibleCardIds) || !visibleCardIds.every((id) => typeof id === "string")) {
    throw new AppError('"visibleCardIds" must be an array of strings', 400);
  }
}

/**
 * Full overwrite of mode + visibleCardIds together, never a partial update — web-nuxt's settings popover
 * (2026-09-07) always saves both at once, so there's no endpoint to change just one.
 * Card ids aren't validated against a known list, same reasoning as updateDashboardCardSettings.
 *
 * `pinnedMetricSlugs` omitted leaves the stored value alone; see the port for why that one exception
 * exists and why it is transitional.
 */
export async function updateStockDetailPreferences(
  firebaseUid: string,
  mode: unknown,
  visibleCardIds: unknown,
  pinnedMetricSlugs: string[] | undefined,
  deps: StockDetailPreferencesDeps,
): Promise<StockDetailPreferences> {
  assertValidMode(mode);
  assertValidVisibleCardIds(visibleCardIds);
  const row = await deps.userPreferences.saveStockDetailPreferences(firebaseUid, mode, visibleCardIds, pinnedMetricSlugs);
  return { mode: row.mode, visibleCardIds: row.visibleCardIds, pinnedMetricSlugs: row.pinnedMetricSlugs };
}
