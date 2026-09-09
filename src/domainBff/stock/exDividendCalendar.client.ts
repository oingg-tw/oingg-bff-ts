import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { ExDividendCalendarEntry, ExDividendCalendarResult } from "@/domainBff/stock/exDividendCalendar.types.js";
import type { ExDividendType } from "@/domainBff/stock/exDividendNotices.types.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function isExDividendType(value: unknown): value is ExDividendType {
  return value === "息" || value === "權" || value === "權息";
}

function normalizeEntry(raw: unknown): ExDividendCalendarEntry {
  const r = raw as Record<string, unknown>;
  const symbol = String(r.symbol);
  if (!isExDividendType(r.exType)) {
    throw new AppError(`Ex-dividend calendar entry for "${symbol}" has an unrecognized exType`, 502);
  }
  return {
    symbol,
    companyName: typeof r.companyName === "string" ? r.companyName : null,
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

function isCalendarResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Market-wide ex-dividend/ex-rights calendar for one month from analysis-ts's own
 * GET /stocks/ex-dividend-calendar?month=YYYY-MM (added 2026-09-10) — same field shape as
 * GET /stocks/ex-dividend-notices (fetchExDividendNotices) but a flat array covering every symbol for the
 * given month, not grouped/filtered to one symbol's future events. Confirmed live: no future-only filter
 * (a month can be entirely in the past or future and still return its real events), companyName is null
 * for ETFs (not in analysis-ts's company reference table), and an out-of-range/no-data month returns
 * `entries: []`, not an error.
 */
export async function fetchExDividendCalendar(month: string): Promise<ExDividendCalendarResult> {
  const url = buildAnalysisServiceUrl("/stocks/ex-dividend-calendar", { month });
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Ex-dividend calendar endpoint");

  const body: unknown = await response.json();
  if (!isCalendarResponse(body)) {
    logger.error({ url: url.toString() }, "Ex-dividend calendar endpoint response is missing an entries array");
    throw new AppError("Ex-dividend calendar endpoint response is missing an entries array", 502);
  }

  return { entries: body.entries.map(normalizeEntry) };
}
