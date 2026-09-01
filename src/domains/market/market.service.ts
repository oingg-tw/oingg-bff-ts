import { AppError } from "@/shared/errorHandler.js";
import { getCompanyNames } from "@/domains/companies/index.js";
import { fetchForeignHoldingRanking, fetchMarginShortRatioRanking } from "@/domains/market/marketRankings.client.js";
import type { ForeignHoldingRankingResult, MarginShortRatioRankingResult } from "@/domains/market/market.types.js";

export const DEFAULT_TOP_PERCENT = 10;
export const MIN_TOP_PERCENT = 1;
export const MAX_TOP_PERCENT = 50;

export const DEFAULT_MARGIN_SHORT_LIMIT = 20;
export const MIN_MARGIN_SHORT_LIMIT = 1;
export const MAX_MARGIN_SHORT_LIMIT = 100;

/** Bounds match analysis-ts's own validation (verified live) — checked here too for a fast local 400. */
export async function getForeignHoldingRanking(topPercent: number): Promise<ForeignHoldingRankingResult> {
  if (!Number.isInteger(topPercent) || topPercent < MIN_TOP_PERCENT || topPercent > MAX_TOP_PERCENT) {
    throw new AppError(`"topPercent" must be an integer between ${MIN_TOP_PERCENT} and ${MAX_TOP_PERCENT}`, 400);
  }
  return fetchForeignHoldingRanking(topPercent);
}

/**
 * Bounds match analysis-ts's own validation (verified live) — checked here too for a fast local 400.
 * Attaches each row's company name from bff-ts's own local Company cache (see companies.service.ts) —
 * a single batched lookup, same pattern as screener.service.ts's mergeCompanyNames.
 */
export async function getMarginShortRatioRanking(limit: number): Promise<MarginShortRatioRankingResult> {
  if (!Number.isInteger(limit) || limit < MIN_MARGIN_SHORT_LIMIT || limit > MAX_MARGIN_SHORT_LIMIT) {
    throw new AppError(
      `"limit" must be an integer between ${MIN_MARGIN_SHORT_LIMIT} and ${MAX_MARGIN_SHORT_LIMIT}`,
      400,
    );
  }
  const result = await fetchMarginShortRatioRanking(limit);
  const namesBySymbol = await getCompanyNames(result.rankings.map((row) => row.symbol));
  return {
    ...result,
    rankings: result.rankings.map((row) => ({ ...row, name: namesBySymbol.get(row.symbol) ?? null })),
  };
}
