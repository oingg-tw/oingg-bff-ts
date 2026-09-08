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

function normalizeEntry(raw: unknown): PreferredStockEntry {
  const r = raw as Record<string, unknown>;

  return {
    symbol: String(r.symbol),
    name: String(r.name),
    isinCode: String(r.isinCode),
    listedDate: String(r.listedDate),
    marketType: String(r.marketType),
    issueDate: String(r.issueDate),
    issuePrice: Number(r.issuePrice),
    dividendRate: Number(r.dividendRate),
    nominalDividendRatePct: Number(r.nominalDividendRatePct),
    currentYieldPct: toNumberOrNull(r.currentYieldPct),
    latestClosePrice: toNumberOrNull(r.latestClosePrice),
    latestPriceDate: toStringOrNull(r.latestPriceDate),
    cumulativeDividend: r.cumulativeDividend === true,
    participatingExcessDividend: r.participatingExcessDividend === true,
    liquidationPreference: r.liquidationPreference === true,
    votingRights: r.votingRights === true,
    convertible: r.convertible === true,
    conversionStartDate: toStringOrNull(r.conversionStartDate),
    redeemable: r.redeemable === true,
    redemptionDate: toStringOrNull(r.redemptionDate),
    redemptionConditions: toStringOrNull(r.redemptionConditions),
    callRiskAmount: toNumberOrNull(r.callRiskAmount),
    ytwPct: toNumberOrNull(r.ytwPct),
    ytcPct: toNumberOrNull(r.ytcPct),
    ytcAssumption:
      r.ytcAssumption === "scheduled_redemption_date" || r.ytcAssumption === "past_redemption_date_assumed_next_period"
        ? r.ytcAssumption
        : null,
    premiumRatePct: toNumberOrNull(r.premiumRatePct),
  };
}

function isPreferredStocksResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * analysis-ts added pagination (2026-09-06): the response now also carries count/limit/offset (default
 * limit 50, max 200 — confirmed live, a limit above 200 is a 400), matching GET /companies. There are
 * only 28 issues today so the default wouldn't truncate yet, but bff-ts's own contract here has no
 * pagination of its own — always request analysis-ts's own maximum so "no symbol" reliably means "every
 * issue", not "whatever analysis-ts's current default page size happens to be".
 */
const LIST_ALL_LIMIT = "200";

/**
 * Fetches TWSE-listed preferred stocks from analysis-ts's GET /preferred-stocks. Omitting `symbol`
 * returns every currently-listed issue (28 as of 2026-09-06); a given symbol with no match comes back
 * as an empty `entries` array, never a 404 (confirmed with analysis-ts directly).
 */
export async function fetchPreferredStocks(symbol?: string): Promise<PreferredStocksResult> {
  const searchParams: Record<string, string> = { limit: LIST_ALL_LIMIT };
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
