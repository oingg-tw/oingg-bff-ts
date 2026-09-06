import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { PreferredStockEntry, PreferredStocksResult } from "@/domainBff/stock/preferredStocks.types.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Rounds to 2 decimals — avoids floating-point noise from a plain subtraction (e.g. 43.45 - 50). */
function roundTo2Decimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeEntry(raw: unknown): PreferredStockEntry {
  const r = raw as Record<string, unknown>;
  const issuePrice = Number(r.issuePrice);
  const latestClosePrice = toNumberOrNull(r.latestClosePrice);

  return {
    symbol: String(r.symbol),
    name: String(r.name),
    isinCode: String(r.isinCode),
    listedDate: String(r.listedDate),
    marketType: String(r.marketType),
    issueDate: String(r.issueDate),
    issuePrice,
    dividendRate: Number(r.dividendRate),
    nominalDividendRatePct: Number(r.nominalDividendRatePct),
    currentYieldPct: toNumberOrNull(r.currentYieldPct),
    latestClosePrice,
    latestPriceDate: toStringOrNull(r.latestPriceDate),
    priceMinusIssuePrice: latestClosePrice === null ? null : roundTo2Decimals(latestClosePrice - issuePrice),
    cumulativeDividend: r.cumulativeDividend === true,
    participatingExcessDividend: r.participatingExcessDividend === true,
    liquidationPreference: r.liquidationPreference === true,
    votingRights: r.votingRights === true,
    convertible: r.convertible === true,
    conversionStartDate: toStringOrNull(r.conversionStartDate),
    redeemable: r.redeemable === true,
    redemptionDate: toStringOrNull(r.redemptionDate),
    redemptionConditions: toStringOrNull(r.redemptionConditions),
  };
}

function isPreferredStocksResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches TWSE-listed preferred stocks from analysis-ts's GET /preferred-stocks. Omitting `symbol`
 * returns every currently-listed issue (28 as of 2026-09-06); a given symbol with no match comes back
 * as an empty `entries` array, never a 404 (confirmed with analysis-ts directly).
 */
export async function fetchPreferredStocks(symbol?: string): Promise<PreferredStocksResult> {
  const searchParams: Record<string, string> = {};
  if (symbol !== undefined) {
    searchParams.symbol = symbol;
  }

  const url = buildAnalysisServiceUrl("/preferred-stocks", searchParams);
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Preferred stocks endpoint");

  const body: unknown = await response.json();
  if (!isPreferredStocksResponse(body)) {
    logger.error({ url: url.toString() }, "Preferred stocks endpoint response is missing an entries array");
    throw new AppError("Preferred stocks endpoint response is missing an entries array", 502);
  }

  return { entries: body.entries.map(normalizeEntry) };
}
