import { fetchCapitalStockHistory } from "@/domains/stock/capitalStockHistory.client.js";
import type { CapitalStockHistoryResult } from "@/domains/stock/capitalStockHistory.types.js";
import { fetchCompanyProfile } from "@/domains/stock/companyProfile.client.js";
import type { CompanyProfile } from "@/domains/stock/companyProfile.types.js";
import { fetchExDividendNotices } from "@/domains/stock/exDividendNotices.client.js";
import type { ExDividendNoticeEntry } from "@/domains/stock/exDividendNotices.types.js";
import { fetchStockPrices, fetchStockQuote } from "@/domains/stock/stockQuote.client.js";
import type { StockQuote } from "@/domains/stock/stock.types.js";

export interface ClosePrice {
  close: string | null;
  tradeDate: string | null;
}

/** Single-symbol quote — holdings/transactions/watchlist symbol validation, GET /stocks/:symbol. */
export async function getStockQuote(symbol: string): Promise<StockQuote | null> {
  return fetchStockQuote(symbol);
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
