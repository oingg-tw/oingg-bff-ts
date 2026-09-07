import { AppError } from "@/shared/errorHandler.js";
import {
  findStockDetailPreferences,
  upsertStockDetailPreferences,
} from "@/domainBusiness/user/stockDetailPreferences.repository.js";
import type { StockDetailPageMode, StockDetailPreferences } from "@/domainBusiness/user/stockDetailPreferences.types.js";

const VALID_MODES: StockDetailPageMode[] = ["CARD", "ACCOUNTING"];

/**
 * `mode`/`visibleCardIds` both null means "no preference saved yet" — the frontend applies its own
 * local default for each, same reasoning as getDashboardCardSettings.
 */
export async function getStockDetailPreferences(firebaseUid: string): Promise<StockDetailPreferences> {
  const row = await findStockDetailPreferences(firebaseUid);
  return { mode: row?.mode ?? null, visibleCardIds: row?.visibleCardIds ?? null };
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
 * Full overwrite of both fields together, never a partial update — web-nuxt's settings popover
 * (2026-09-07) always saves mode and visibleCardIds at once, so there's no endpoint to change just one.
 * Card ids aren't validated against a known list, same reasoning as updateDashboardCardSettings.
 */
export async function updateStockDetailPreferences(
  firebaseUid: string,
  mode: unknown,
  visibleCardIds: unknown,
): Promise<StockDetailPreferences> {
  assertValidMode(mode);
  assertValidVisibleCardIds(visibleCardIds);
  const row = await upsertStockDetailPreferences(firebaseUid, mode, visibleCardIds);
  return { mode: row.mode, visibleCardIds: row.visibleCardIds };
}
