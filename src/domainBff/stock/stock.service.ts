import { AppError } from "@/shared/errorHandler.js";
import { fetchCapitalStockHistory } from "@/domainBff/stock/capitalStockHistory.client.js";
import type { CapitalStockHistoryResult } from "@/domainBff/stock/capitalStockHistory.types.js";
import { fetchCompanyProfile } from "@/domainBff/stock/companyProfile.client.js";
import type { CompanyProfile } from "@/domainBff/stock/companyProfile.types.js";
import { fetchExDividendNotices } from "@/domainBff/stock/exDividendNotices.client.js";
import type { ExDividendNoticeEntry } from "@/domainBff/stock/exDividendNotices.types.js";
import { fetchFinancialStatement } from "@/domainBff/stock/financialStatement.client.js";
import type { FinancialStatementResult, FinancialStatementType } from "@/domainBff/stock/financialStatement.types.js";
import { fetchDupontHistory } from "@/domainBff/stock/dupontHistory.client.js";
import type { DupontHistoryBasis, DupontHistoryResult } from "@/domainBff/stock/dupontHistory.types.js";
import { fetchMetricHistory } from "@/domainBff/stock/metricHistory.client.js";
import type { MetricHistoryBasis, MetricHistoryCode, MetricHistoryResult } from "@/domainBff/stock/metricHistory.types.js";
import { fetchPreferredStocks } from "@/domainBff/stock/preferredStocks.client.js";
import type { PreferredStocksResult } from "@/domainBff/stock/preferredStocks.types.js";
import { fetchRoaHistory, fetchRoeHistory } from "@/domainBff/stock/roeRoaHistory.client.js";
import type { RoaHistoryResult, RoeHistoryResult, RoeRoaHistoryBasis } from "@/domainBff/stock/roeRoaHistory.types.js";
import { fetchStockPrices, fetchStockQuote } from "@/domainBff/stock/stockQuote.client.js";
import type { StockQuote } from "@/domainBff/stock/stock.types.js";

export interface ClosePrice {
  close: string | null;
  tradeDate: string | null;
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

/** Historical paid-in-capital/shares changes — GET /stocks/:symbol/capital-stock-history. */
export async function getCapitalStockHistory(symbol: string): Promise<CapitalStockHistoryResult> {
  return fetchCapitalStockHistory(symbol);
}

/** Batched upcoming ex-dividend/ex-rights lookup — GET /stocks/ex-dividend-notices. */
export async function getExDividendNotices(symbols: string[]): Promise<Map<string, ExDividendNoticeEntry[]>> {
  return fetchExDividendNotices(symbols);
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

/** Quarterly EPS/PER/PBR time series (for stock-detail charts) — GET /stocks/:symbol/metric-history. */
export async function getMetricHistory(
  symbol: string,
  metricCode: MetricHistoryCode,
  basis: MetricHistoryBasis,
  limit?: number,
): Promise<MetricHistoryResult> {
  return fetchMetricHistory(symbol, metricCode, basis, limit);
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
