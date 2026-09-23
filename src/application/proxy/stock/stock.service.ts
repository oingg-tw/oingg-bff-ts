import { AppError } from "@/domain/appError.js";
import { fetchBeta } from "@/infrastructure/analysisApi/stock/beta.client.js";
import type { BetaResult } from "@/application/proxy/stock/beta.types.js";
import { fetchCompanyBadges } from "@/infrastructure/analysisApi/stock/companyBadges.client.js";
import type { CompanyBadgesResult } from "@/application/proxy/stock/companyBadges.types.js";
import { fetchCompanyList } from "@/infrastructure/analysisApi/stock/companyList.client.js";
import type { CompanyListResult } from "@/application/proxy/stock/companyList.types.js";
import { fetchCapitalStockHistory } from "@/infrastructure/analysisApi/stock/capitalStockHistory.client.js";
import type { CapitalStockHistoryResult } from "@/application/proxy/stock/capitalStockHistory.types.js";
import { fetchDividendHistory } from "@/infrastructure/analysisApi/stock/dividendHistory.client.js";
import type { DividendHistoryResult } from "@/application/proxy/stock/dividendHistory.types.js";
import { fetchCompanyProfile } from "@/infrastructure/analysisApi/stock/companyProfile.client.js";
import type { CompanyProfile } from "@/application/proxy/stock/companyProfile.types.js";
import { fetchExDividendCalendar } from "@/infrastructure/analysisApi/stock/exDividendCalendar.client.js";
import type { ExDividendCalendarResult } from "@/application/proxy/stock/exDividendCalendar.types.js";
import { fetchExDividendNotices } from "@/infrastructure/analysisApi/stock/exDividendNotices.client.js";
import type { ExDividendNoticeEntry } from "@/application/proxy/stock/exDividendNotices.types.js";
import { fetchFinancialStatement } from "@/infrastructure/analysisApi/stock/financialStatement.client.js";
import type { FinancialStatementResult, FinancialStatementType } from "@/application/proxy/stock/financialStatement.types.js";
import { fetchDailyPriceHistory } from "@/infrastructure/analysisApi/stock/dailyPriceHistory.client.js";
import type { DailyPriceHistoryResult } from "@/application/proxy/stock/dailyPriceHistory.types.js";
import { fetchForeignShareholdingHistory } from "@/infrastructure/analysisApi/stock/foreignShareholdingHistory.client.js";
import type { ForeignShareholdingHistoryResult } from "@/application/proxy/stock/foreignShareholdingHistory.types.js";
import { fetchDupontHistory } from "@/infrastructure/analysisApi/stock/dupontHistory.client.js";
import type { DupontHistoryBasis, DupontHistoryResult } from "@/application/proxy/stock/dupontHistory.types.js";
import { fetchMetricHistory } from "@/infrastructure/analysisApi/stock/metricHistory.client.js";
import type { MetricHistoryBasis, MetricHistoryCode, MetricHistoryResult } from "@/application/proxy/stock/metricHistory.types.js";
import { fetchMetricsHistory } from "@/infrastructure/analysisApi/stock/metricsHistory.client.js";
import type { MetricsHistoryResult } from "@/application/proxy/stock/metricsHistory.types.js";
import { fetchMonthlyRevenueHistory } from "@/infrastructure/analysisApi/stock/monthlyRevenueHistory.client.js";
import type { MonthlyRevenueHistoryResult } from "@/application/proxy/stock/monthlyRevenueHistory.types.js";
import { fetchPreferredStocks } from "@/infrastructure/analysisApi/stock/preferredStocks.client.js";
import type { PreferredStocksResult } from "@/application/proxy/stock/preferredStocks.types.js";
import { fetchPreferredStockFieldCatalog } from "@/infrastructure/analysisApi/stock/preferredStocksFieldCatalog.client.js";
import type { PreferredStockFieldCatalogResult } from "@/application/proxy/stock/preferredStocksFieldCatalog.types.js";
import { fetchPiotroskiBreakdown } from "@/infrastructure/analysisApi/stock/piotroskiBreakdown.client.js";
import type { PiotroskiBreakdownResult } from "@/application/proxy/stock/piotroskiBreakdown.types.js";
import { fetchMetricProvenance } from "@/infrastructure/analysisApi/stock/metricProvenance.client.js";
import type { MetricProvenanceMetricCode, MetricProvenanceResult } from "@/application/proxy/stock/metricProvenance.types.js";
import { fetchRoaHistory, fetchRoeHistory } from "@/infrastructure/analysisApi/stock/roeRoaHistory.client.js";
import type { RoaHistoryResult, RoeHistoryResult, RoeRoaHistoryBasis } from "@/application/proxy/stock/roeRoaHistory.types.js";
import { fetchStockPrices, fetchStockQuote } from "@/infrastructure/analysisApi/stock/stockQuote.client.js";
import type { StockQuote } from "@/application/proxy/stock/stock.types.js";

export interface ClosePrice {
  close: string | null;
  tradeDate: string | null;
}

/** Full-market company directory (symbol/name, paginated) — GET /stocks. */
export async function getCompanyList(limit?: number, offset?: number): Promise<CompanyListResult> {
  return fetchCompanyList(limit, offset);
}

/** Single-symbol quote — GET /stocks/:symbol. */
export async function getStockQuote(symbol: string): Promise<StockQuote | null> {
  return fetchStockQuote(symbol);
}

/**
 * Shared by the holdings/transactions/watchlist route handlers (業務中台) to confirm a symbol is real
 * before creating a row for it — kept on this side (bff) rather than called from inside those domains'
 * own services, since checking against a live quote is a call into this BFF's pass-through data, not
 * something the owning domain's CRUD service should reach across module boundaries for itself.
 */
export async function assertSymbolExists(symbol: string): Promise<void> {
  const quote = await getStockQuote(symbol);
  if (!quote) {
    throw new AppError(`Unknown stock symbol "${symbol}"`, 404);
  }
}

/**
 * Batched close-price lookup for the screener's "stock.price" display column — see
 * stockQuote.client.ts's fetchStockPrices for why a missing symbol is simply absent from the map rather
 * than mapped to a null/empty ClosePrice.
 */
export async function getLatestClosePrices(symbols: string[]): Promise<Map<string, ClosePrice>> {
  return fetchStockPrices(symbols);
}

/** Company basic-info profile — GET /stocks/:symbol/profile. */
export async function getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  return fetchCompanyProfile(symbol);
}

/** Beta coefficient across all 3 fixed windows (1Y_1D/2Y_1W/5Y_1M) — GET /stocks/:symbol/beta. */
export async function getBeta(symbol: string): Promise<BetaResult> {
  return fetchBeta(symbol);
}

/** Evaluated "guru badges" (value + pass/fail per badge) for one symbol — GET /stocks/:symbol/badges. */
export async function getCompanyBadges(symbol: string): Promise<CompanyBadgesResult> {
  return fetchCompanyBadges(symbol);
}

/** Historical paid-in-capital/shares changes — GET /stocks/:symbol/capital-stock-history. */
export async function getCapitalStockHistory(symbol: string): Promise<CapitalStockHistoryResult> {
  return fetchCapitalStockHistory(symbol);
}

/** Fiscal-year dividend history — GET /stocks/:symbol/dividend-history. */
export async function getDividendHistory(symbol: string): Promise<DividendHistoryResult> {
  return fetchDividendHistory(symbol);
}

/** Batched upcoming ex-dividend/ex-rights lookup — GET /stocks/ex-dividend-notices. */
export async function getExDividendNotices(symbols: string[]): Promise<Map<string, ExDividendNoticeEntry[]>> {
  return fetchExDividendNotices(symbols);
}

/** Market-wide ex-dividend/ex-rights calendar for one month — GET /stocks/ex-dividend-calendar. */
export async function getExDividendCalendar(month: string): Promise<ExDividendCalendarResult> {
  return fetchExDividendCalendar(month);
}

/** One quarter's raw financial statement (for 會計模式) — GET /stocks/:symbol/financial-statement. */
export async function getFinancialStatement(
  symbol: string,
  statementType: FinancialStatementType,
  year?: string,
  season?: string,
): Promise<FinancialStatementResult> {
  return fetchFinancialStatement(symbol, statementType, year, season);
}

/** TWSE-listed preferred stocks (all, or one symbol) — GET /stocks/preferred-stocks. */
export async function getPreferredStocks(symbol?: string): Promise<PreferredStocksResult> {
  return fetchPreferredStocks(symbol);
}

/** Static formula/inputs documentation for preferred-stock derived fields — GET /stocks/preferred-stocks/field-catalog. */
export async function getPreferredStockFieldCatalog(): Promise<PreferredStockFieldCatalogResult> {
  return fetchPreferredStockFieldCatalog();
}

/** Quarterly EPS/PER/PBR time series (for stock-detail charts) — GET /stocks/:symbol/metric-history. */
export async function getMetricHistory(
  symbol: string,
  metricCode: MetricHistoryCode,
  basis: MetricHistoryBasis,
  limit?: number,
): Promise<MetricHistoryResult> {
  return fetchMetricHistory(symbol, metricCode, basis, limit);
}

/** Multiple metrics' history for one symbol at once (for growth-decomposition cards) — GET /stocks/:symbol/metrics-history. */
export async function getMetricsHistory(
  symbol: string,
  metricCodes: string[],
  basis: string,
  limit?: number,
): Promise<MetricsHistoryResult> {
  return fetchMetricsHistory(symbol, metricCodes, basis, limit);
}

/** Quarterly ROE (股東權益報酬率) time series — GET /stocks/:symbol/roe-history. */
export async function getRoeHistory(
  symbol: string,
  basis: RoeRoaHistoryBasis,
  limit?: number,
): Promise<RoeHistoryResult> {
  return fetchRoeHistory(symbol, basis, limit);
}

/** Quarterly ROA (資產報酬率) time series — GET /stocks/:symbol/roa-history. */
export async function getRoaHistory(
  symbol: string,
  basis: RoeRoaHistoryBasis,
  limit?: number,
): Promise<RoaHistoryResult> {
  return fetchRoaHistory(symbol, basis, limit);
}

/** Quarterly DuPont-decomposed ROE time series — GET /stocks/:symbol/dupont-history. */
export async function getDupontHistory(
  symbol: string,
  basis: DupontHistoryBasis,
  limit?: number,
): Promise<DupontHistoryResult> {
  return fetchDupontHistory(symbol, basis, limit);
}

/** Monthly revenue/YoY/MoM history (月營收年增率) — GET /stocks/:symbol/monthly-revenue-history. */
export async function getMonthlyRevenueHistory(symbol: string, limit?: number): Promise<MonthlyRevenueHistoryResult> {
  return fetchMonthlyRevenueHistory(symbol, limit);
}

/** Daily foreign-shareholding-percentage history — GET /stocks/:symbol/foreign-shareholding-history. */
export async function getForeignShareholdingHistory(symbol: string, limit?: number): Promise<ForeignShareholdingHistoryResult> {
  return fetchForeignShareholdingHistory(symbol, limit);
}

/** Daily OHLCV price history — GET /stocks/:symbol/daily-price-history. */
export async function getDailyPriceHistory(symbol: string, limit?: number): Promise<DailyPriceHistoryResult> {
  return fetchDailyPriceHistory(symbol, limit);
}

/** Piotroski F-Score's 9 underlying boolean signals, grouped into 3 categories — GET /stocks/:symbol/piotroski-breakdown. */
export async function getPiotroskiBreakdown(symbol: string, year?: string, season?: string): Promise<PiotroskiBreakdownResult> {
  return fetchPiotroskiBreakdown(symbol, year, season);
}

/** Raw-filing provenance trail behind one metric's computed value (trace-to-source) — GET /stocks/:symbol/metric-provenance. */
export async function getMetricProvenance(
  symbol: string,
  metricCode: MetricProvenanceMetricCode,
  year?: string,
  season?: string,
): Promise<MetricProvenanceResult> {
  return fetchMetricProvenance(symbol, metricCode, year, season);
}
