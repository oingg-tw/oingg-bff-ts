import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { ExDividendNoticeEntry, ExDividendType } from "@/domains/stock/exDividendNotices.types.js";

const MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST = 100;

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function isExDividendType(value: unknown): value is ExDividendType {
  return value === "息" || value === "權" || value === "權息";
}

function normalizeEntry(raw: unknown, symbol: string): ExDividendNoticeEntry {
  const r = raw as Record<string, unknown>;
  if (!isExDividendType(r.exType)) {
    throw new AppError(`Ex-dividend notice for "${symbol}" has an unrecognized exType`, 502);
  }
  return {
    exDate: String(r.exDate),
    exType: r.exType,
    stockDividendRatio: toNumberOrNull(r.stockDividendRatio),
    subscriptionRatio: toNumberOrNull(r.subscriptionRatio),
    subscriptionPricePerShare: toNumberOrNull(r.subscriptionPricePerShare),
    cashDividend: toNumberOrNull(r.cashDividend),
    sharesOffered: toNumberOrNull(r.sharesOffered),
    sharesEmpOwner: toNumberOrNull(r.sharesEmpOwner),
    sharesholderOwner: toNumberOrNull(r.sharesholderOwner),
    stockHoldingRatio: toNumberOrNull(r.stockHoldingRatio),
  };
}

function isNoticesResponse(body: unknown): body is { notices: Record<string, unknown> } {
  const notices = (body as { notices?: unknown } | null)?.notices;
  return typeof body === "object" && body !== null && typeof notices === "object" && notices !== null;
}

/**
 * Batched upcoming ex-dividend/ex-rights lookup from analysis-ts's GET /stocks/ex-dividend-notices — same
 * batching convention as stockQuote.client.ts's fetchStockPrices (comma-separated symbols=, 100-symbol
 * hard cap, 500 if exceeded rather than a silent truncation). A symbol with no upcoming notice is simply
 * absent from the returned map (confirmed with analysis-ts), not present with an empty array. Each
 * symbol's own array is already sorted nearest-exDate-first by analysis-ts.
 */
export async function fetchExDividendNotices(symbols: string[]): Promise<Map<string, ExDividendNoticeEntry[]>> {
  if (symbols.length === 0) {
    return new Map();
  }
  if (symbols.length > MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST) {
    throw new AppError(
      `Requested ${symbols.length} symbols at once, but the ex-dividend notices endpoint caps at ${MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST}`,
      500,
    );
  }

  const url = buildAnalysisServiceUrl("/stocks/ex-dividend-notices", { symbols: symbols.join(",") });
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Ex-dividend notices endpoint");

  const body: unknown = await response.json();
  if (!isNoticesResponse(body)) {
    logger.error({ url: url.toString() }, 'Ex-dividend notices endpoint response is missing a "notices" object');
    throw new AppError('Ex-dividend notices endpoint response is missing a "notices" object', 502);
  }

  return new Map(
    Object.entries(body.notices).map(([symbol, entries]) => [
      symbol,
      (entries as unknown[]).map((entry) => normalizeEntry(entry, symbol)),
    ]),
  );
}
