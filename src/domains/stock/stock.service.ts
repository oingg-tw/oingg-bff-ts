import { AppError } from "../../shared/errorHandler.js";
import type { StockQuote } from "./stock.types.js";

const MIGRATION_NOTICE =
  'Stock quote lookups are temporarily unavailable: direct access to twse/tpex was removed per the ' +
  '"bff-ts only talks to analysis-ts" architecture rule, and analysis-ts does not yet expose a ' +
  "replacement API (see docs/直連DB反模式修復計畫.md — blocked on analysis-ts's own twse/tpex mirror " +
  "being incomplete). This is a deliberate, accepted short-term regression, not a bug to silently work " +
  "around by reconnecting to twse/tpex directly.";

export interface ClosePrice {
  close: string | null;
  tradeDate: string | null;
}

/**
 * Was: check twse then tpex directly (a symbol belongs to exactly one market). Direct DB access to
 * twse-ts/tpex-ts is no longer allowed (bff-ts may only talk to analysis-ts) — throws until
 * analysis-ts exposes a replacement lookup API, rather than silently returning null (which would read
 * as "unknown symbol" to every caller — holdings/transactions/watchlist symbol validation, GET
 * /stocks/:symbol — and that would be actively misleading about why it's failing).
 */
export async function getStockQuote(_symbol: string): Promise<StockQuote | null> {
  throw new AppError(MIGRATION_NOTICE, 503);
}

/**
 * Was: batched twse+tpex close-price lookup for the screener's "stock.price" display column. Direct DB
 * access to twse-ts/tpex-ts is no longer allowed. Unlike getStockQuote, this degrades gracefully (empty
 * map -> every symbol's stock.price shows as null) instead of throwing: "stock.price" is part of the
 * system default columns, so throwing here would break the entire screener/ranking feature over a
 * missing display column, not just the price lookup itself.
 */
export async function getLatestClosePrices(_symbols: string[]): Promise<Map<string, ClosePrice>> {
  return new Map();
}
