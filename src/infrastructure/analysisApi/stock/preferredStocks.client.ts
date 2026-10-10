import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import { readPreferredMarketFields } from "@/infrastructure/analysisApi/market/marketCode.js";
import type { PreferredStockEntry, PreferredStocksResult } from "@/application/proxy/stock/preferredStocks.types.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeEntry(raw: unknown): PreferredStockEntry {
  const r = raw as Record<string, unknown>;

  return {
    symbol: String(r.symbol),
    name: String(r.name),
    // toStringOrNull, not String(): String(null) is the literal "null", which would reach the UI looking
    // like real data. Both became nullable upstream on 2026-10-07 (see PreferredStockEntry).
    isinCode: toStringOrNull(r.isinCode),
    listedDate: toStringOrNull(r.listedDate),
    // 上游 2026-10-24 移除中文 marketType、改給 marketCode；String() 會在那天變成字串 "undefined"。見 marketCode.ts。
    ...readPreferredMarketFields(r),
    issueDate: toStringOrNull(r.issueDate),
    issuePrice: toNumberOrNull(r.issuePrice),
    dividendRate: toNumberOrNull(r.dividendRate),
    nominalDividendRatePct: toNumberOrNull(r.nominalDividendRatePct),
    currentYieldPct: toNumberOrNull(r.currentYieldPct),
    latestClosePrice: toNumberOrNull(r.latestClosePrice),
    latestPriceDate: toStringOrNull(r.latestPriceDate),
    // 發行條款查無時整組是 null（見 PreferredStockEntry）——不要用 Number()／String()／=== true，那會捏造 0／"null"／false。
    cumulativeDividend: toBooleanOrNull(r.cumulativeDividend),
    participatingExcessDividend: toBooleanOrNull(r.participatingExcessDividend),
    liquidationPreference: toBooleanOrNull(r.liquidationPreference),
    votingRights: toBooleanOrNull(r.votingRights),
    convertible: toBooleanOrNull(r.convertible),
    conversionStartDate: toStringOrNull(r.conversionStartDate),
    redeemable: toBooleanOrNull(r.redeemable),
    redemptionDate: toStringOrNull(r.redemptionDate),
    redemptionConditions: toStringOrNull(r.redemptionConditions),
    ytwPct: toNumberOrNull(r.ytwPct),
    ytcPct: toNumberOrNull(r.ytcPct),
    ytcAssumption:
      r.ytcAssumption === "scheduled_redemption_date" ||
      r.ytcAssumption === "past_redemption_date_assumed_next_period" ||
      r.ytcAssumption === "no_scheduled_redemption_date_assumed_next_period"
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
  await assertAnalysisServiceOk(response, url, "Preferred stocks endpoint");

  const body: unknown = await response.json();
  if (!isPreferredStocksResponse(body)) {
    logger.error({ url: url.toString() }, "Preferred stocks endpoint response is missing an entries array");
    throw new AppError("Preferred stocks endpoint response is missing an entries array", 502);
  }

  return { entries: body.entries.map(normalizeEntry) };
}
