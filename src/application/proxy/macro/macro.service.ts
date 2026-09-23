import {
  fetchBusinessCycleIndicator,
  fetchCbcPolicyRate,
  fetchCpi,
  fetchGdp,
  fetchGovBondYield10y,
  fetchGovBondYield10yHistory,
  fetchMonetaryAggregate,
  fetchStockMarketSummary,
  fetchUsdTwdRate,
} from "@/infrastructure/analysisApi/macro/macro.client.js";
import type {
  BusinessCycleIndicatorResult,
  CbcPolicyRateResult,
  CpiCategory,
  CpiResult,
  GdpCategory,
  GdpResult,
  GovBondYield10yHistoryResult,
  GovBondYield10yResult,
  MonetaryAggregateResult,
  StockMarketSummaryResult,
  UsdTwdRateInterval,
  UsdTwdRateResult,
} from "@/application/proxy/macro/macro.types.js";

// All query validation (date formats, category enums, limit bounds, interval enum) lives in
// macro.routes.ts's zod schemas — they double as the OpenAPI source of truth, same as the screener domain.

/** CBC policy-rate adjustment events, oldest to newest — GET /macro/cbc-policy-rate. */
export async function getCbcPolicyRate(from?: string): Promise<CbcPolicyRateResult> {
  return fetchCbcPolicyRate(from);
}

/** 國發會 景氣指標／景氣對策信號 monthly — GET /macro/business-cycle-indicator. */
export async function getBusinessCycleIndicator(from?: string): Promise<BusinessCycleIndicatorResult> {
  return fetchBusinessCycleIndicator(from);
}

/** 央行 M1A/M1B/M2 monthly — GET /macro/monetary-aggregate. */
export async function getMonetaryAggregate(from?: string): Promise<MonetaryAggregateResult> {
  return fetchMonetaryAggregate(from);
}

/** Latest 10-year 公債殖利率 snapshot — GET /macro/gov-bond-yield-10y. */
export async function getGovBondYield10y(): Promise<GovBondYield10yResult> {
  return fetchGovBondYield10y();
}

/** 10-year 公債殖利率 monthly history — GET /macro/gov-bond-yield-10y-history. */
export async function getGovBondYield10yHistory(from?: string): Promise<GovBondYield10yHistoryResult> {
  return fetchGovBondYield10yHistory(from);
}

/** CBC 集中市場 monthly summary (1987-05 onward) — GET /macro/stock-market-summary. */
export async function getStockMarketSummary(from?: string): Promise<StockMarketSummaryResult> {
  return fetchStockMarketSummary(from);
}

/** USD/TWD daily/weekly/monthly series — GET /macro/usd-twd-rate. */
export async function getUsdTwdRate(limit?: number, interval?: UsdTwdRateInterval): Promise<UsdTwdRateResult> {
  return fetchUsdTwdRate(limit, interval);
}

/** 主計總處 CPI monthly for one category — GET /macro/cpi. */
export async function getCpi(from?: string, category?: CpiCategory): Promise<CpiResult> {
  return fetchCpi(from, category);
}

/** 主計總處 GDP quarterly for one expenditure component — GET /macro/gdp. */
export async function getGdp(from?: string, category?: GdpCategory): Promise<GdpResult> {
  return fetchGdp(from, category);
}
