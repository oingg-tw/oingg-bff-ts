import { AppError } from "@/shared/errorHandler.js";
import {
  fetchAttentionStocks,
  fetchDisposedStocks,
  fetchEtfRanking,
  fetchForeignHoldingRanking,
  fetchMarginShortRatioRanking,
  fetchMaterialAnnouncements,
  fetchPriceChangeRanking,
  fetchPriceLimitRange,
  fetchRevenueRanking,
  fetchVolumeTop20,
} from "@/domains/market/marketRankings.client.js";
import type {
  AttentionStocksResult,
  DisposedStocksResult,
  EtfRankingMetric,
  EtfRankingResult,
  ForeignHoldingRankingResult,
  MarginShortRatioRankingResult,
  MaterialAnnouncementsResult,
  PriceChangeRankingResult,
  PriceLimitRangeResult,
  RankingOrder,
  RevenueRankingMetric,
  RevenueRankingResult,
  VolumeTop20Result,
} from "@/domains/market/market.types.js";

const REVENUE_RANKING_METRICS: readonly RevenueRankingMetric[] = ["yoy", "mom", "revenue"];
const RANKING_ORDERS: readonly RankingOrder[] = ["asc", "desc"];
const ETF_RANKING_METRICS: readonly EtfRankingMetric[] = [
  "aum",
  "holders",
  "netFlow",
  "dcaAmount",
  "return3m",
  "return6m",
  "return1y",
  "return2y",
  "return3y",
  "return5y",
  "returnYtd",
  "return10y",
  "expenseRatio",
];

export const DEFAULT_FOREIGN_HOLDING_LIMIT = 10;
export const MIN_FOREIGN_HOLDING_LIMIT = 1;
export const MAX_FOREIGN_HOLDING_LIMIT = 20;

export const DEFAULT_MARGIN_SHORT_LIMIT = 20;
export const MIN_MARGIN_SHORT_LIMIT = 1;
export const MAX_MARGIN_SHORT_LIMIT = 100;

export const DEFAULT_MATERIAL_ANNOUNCEMENTS_LIMIT = 20;
export const MIN_MATERIAL_ANNOUNCEMENTS_LIMIT = 1;
export const MAX_MATERIAL_ANNOUNCEMENTS_LIMIT = 50;

export const DEFAULT_REVENUE_RANKING_LIMIT = 20;
export const MIN_REVENUE_RANKING_LIMIT = 1;
export const MAX_REVENUE_RANKING_LIMIT = 50;

export const DEFAULT_DISPOSED_STOCKS_LIMIT = 20;
export const MIN_DISPOSED_STOCKS_LIMIT = 1;
export const MAX_DISPOSED_STOCKS_LIMIT = 50;

export const DEFAULT_ATTENTION_STOCKS_LIMIT = 20;
export const MIN_ATTENTION_STOCKS_LIMIT = 1;
export const MAX_ATTENTION_STOCKS_LIMIT = 50;

export const DEFAULT_PRICE_CHANGE_RANKING_LIMIT = 20;
export const MIN_PRICE_CHANGE_RANKING_LIMIT = 1;
export const MAX_PRICE_CHANGE_RANKING_LIMIT = 50;

export const DEFAULT_ETF_RANKING_LIMIT = 20;
export const MIN_ETF_RANKING_LIMIT = 1;
export const MAX_ETF_RANKING_LIMIT = 50;

/**
 * Bounds match analysis-ts's own validation (verified live) — checked here too for a fast local 400.
 * `limit` replaced this endpoint's original `topPercent` param as of 2026-09-01 (see
 * marketRankings.client.ts's fetchForeignHoldingRanking).
 */
export async function getForeignHoldingRanking(limit: number): Promise<ForeignHoldingRankingResult> {
  if (!Number.isInteger(limit) || limit < MIN_FOREIGN_HOLDING_LIMIT || limit > MAX_FOREIGN_HOLDING_LIMIT) {
    throw new AppError(
      `"limit" must be an integer between ${MIN_FOREIGN_HOLDING_LIMIT} and ${MAX_FOREIGN_HOLDING_LIMIT}`,
      400,
    );
  }
  return fetchForeignHoldingRanking(limit);
}

/** Bounds match analysis-ts's own validation (verified live) — checked here too for a fast local 400. */
export async function getMarginShortRatioRanking(limit: number): Promise<MarginShortRatioRankingResult> {
  if (!Number.isInteger(limit) || limit < MIN_MARGIN_SHORT_LIMIT || limit > MAX_MARGIN_SHORT_LIMIT) {
    throw new AppError(
      `"limit" must be an integer between ${MIN_MARGIN_SHORT_LIMIT} and ${MAX_MARGIN_SHORT_LIMIT}`,
      400,
    );
  }
  return fetchMarginShortRatioRanking(limit);
}

/** Bounds match analysis-ts's own validation (verified live) — checked here too for a fast local 400. */
export async function getMaterialAnnouncements(limit: number): Promise<MaterialAnnouncementsResult> {
  if (
    !Number.isInteger(limit) ||
    limit < MIN_MATERIAL_ANNOUNCEMENTS_LIMIT ||
    limit > MAX_MATERIAL_ANNOUNCEMENTS_LIMIT
  ) {
    throw new AppError(
      `"limit" must be an integer between ${MIN_MATERIAL_ANNOUNCEMENTS_LIMIT} and ${MAX_MATERIAL_ANNOUNCEMENTS_LIMIT}`,
      400,
    );
  }
  return fetchMaterialAnnouncements(limit);
}

/**
 * `metric`/`order` are required upstream (no default, see market.routes.ts's requireStringQueryParam) —
 * only `limit` has one. Bounds/enums match analysis-ts's own validation (verified live).
 */
export async function getRevenueRanking(metric: string, order: string, limit: number): Promise<RevenueRankingResult> {
  if (!REVENUE_RANKING_METRICS.includes(metric as RevenueRankingMetric)) {
    throw new AppError(`"metric" must be one of ${REVENUE_RANKING_METRICS.join(", ")}`, 400);
  }
  if (!RANKING_ORDERS.includes(order as RankingOrder)) {
    throw new AppError(`"order" must be one of ${RANKING_ORDERS.join(", ")}`, 400);
  }
  if (!Number.isInteger(limit) || limit < MIN_REVENUE_RANKING_LIMIT || limit > MAX_REVENUE_RANKING_LIMIT) {
    throw new AppError(
      `"limit" must be an integer between ${MIN_REVENUE_RANKING_LIMIT} and ${MAX_REVENUE_RANKING_LIMIT}`,
      400,
    );
  }
  return fetchRevenueRanking(metric as RevenueRankingMetric, order as RankingOrder, limit);
}

/** No params — always the current top 20 by volume (data permitting). */
export async function getVolumeTop20(): Promise<VolumeTop20Result> {
  return fetchVolumeTop20();
}

/** Bounds match analysis-ts's own validation (verified live) — checked here too for a fast local 400. */
export async function getDisposedStocks(limit: number): Promise<DisposedStocksResult> {
  if (!Number.isInteger(limit) || limit < MIN_DISPOSED_STOCKS_LIMIT || limit > MAX_DISPOSED_STOCKS_LIMIT) {
    throw new AppError(
      `"limit" must be an integer between ${MIN_DISPOSED_STOCKS_LIMIT} and ${MAX_DISPOSED_STOCKS_LIMIT}`,
      400,
    );
  }
  return fetchDisposedStocks(limit);
}

/** Bounds match analysis-ts's own validation (verified live) — checked here too for a fast local 400. */
export async function getAttentionStocks(limit: number): Promise<AttentionStocksResult> {
  if (!Number.isInteger(limit) || limit < MIN_ATTENTION_STOCKS_LIMIT || limit > MAX_ATTENTION_STOCKS_LIMIT) {
    throw new AppError(
      `"limit" must be an integer between ${MIN_ATTENTION_STOCKS_LIMIT} and ${MAX_ATTENTION_STOCKS_LIMIT}`,
      400,
    );
  }
  return fetchAttentionStocks(limit);
}

/** No params — always the current widest/narrowest 20 movers each (data permitting). */
export async function getPriceLimitRange(): Promise<PriceLimitRangeResult> {
  return fetchPriceLimitRange();
}

/**
 * Bounds match analysis-ts's own validation (verified live) — checked here too for a fast local 400.
 * Computed from daily_price (already fully mirrored), not a twse-ts/tpex-ts export dataset — real data
 * from day one, unlike this file's other TWSE+TPEx endpoints (see fetchPriceChangeRanking).
 */
export async function getPriceChangeRanking(limit: number): Promise<PriceChangeRankingResult> {
  if (
    !Number.isInteger(limit) ||
    limit < MIN_PRICE_CHANGE_RANKING_LIMIT ||
    limit > MAX_PRICE_CHANGE_RANKING_LIMIT
  ) {
    throw new AppError(
      `"limit" must be an integer between ${MIN_PRICE_CHANGE_RANKING_LIMIT} and ${MAX_PRICE_CHANGE_RANKING_LIMIT}`,
      400,
    );
  }
  return fetchPriceChangeRanking(limit);
}

/**
 * `metric`/`order` are required upstream (no default, same as getRevenueRanking) — only `limit` has one.
 * Bounds/enums match analysis-ts's own validation (verified live).
 */
export async function getEtfRanking(metric: string, order: string, limit: number): Promise<EtfRankingResult> {
  if (!ETF_RANKING_METRICS.includes(metric as EtfRankingMetric)) {
    throw new AppError(`"metric" must be one of ${ETF_RANKING_METRICS.join(", ")}`, 400);
  }
  if (!RANKING_ORDERS.includes(order as RankingOrder)) {
    throw new AppError(`"order" must be one of ${RANKING_ORDERS.join(", ")}`, 400);
  }
  if (!Number.isInteger(limit) || limit < MIN_ETF_RANKING_LIMIT || limit > MAX_ETF_RANKING_LIMIT) {
    throw new AppError(`"limit" must be an integer between ${MIN_ETF_RANKING_LIMIT} and ${MAX_ETF_RANKING_LIMIT}`, 400);
  }
  return fetchEtfRanking(metric as EtfRankingMetric, order as RankingOrder, limit);
}
