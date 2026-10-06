import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  MonthlyRevenueHistoryEntry,
  MonthlyRevenueHistoryResult,
} from "@/application/proxy/stock/monthlyRevenueHistory.types.js";
import { extractHistoryPageMeta } from "@/infrastructure/analysisApi/stock/historyShared.client.js";

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function normalizeEntry(raw: unknown): MonthlyRevenueHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    yearMonth: String(r.yearMonth),
    reportDate: toStringOrNull(r.reportDate),
    industry: toStringOrNull(r.industry),
    currentMonthRevenue: toStringOrNull(r.currentMonthRevenue),
    lastYearSameMonthRevenue: toStringOrNull(r.lastYearSameMonthRevenue),
    yoyChangePercent: toNumberOrNull(r.yoyChangePercent),
    momChangePercent: toNumberOrNull(r.momChangePercent),
    cumulativeRevenue: toStringOrNull(r.cumulativeRevenue),
    cumulativeLastYearRevenue: toStringOrNull(r.cumulativeLastYearRevenue),
    cumulativeChangePercent: toNumberOrNull(r.cumulativeChangePercent),
    note: toStringOrNull(r.note),
  };
}

function isMonthlyRevenueHistoryResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches monthly revenue history from analysis-ts's GET /companies/monthly-revenue-history — a
 * one-time 60-month backfill (2330-only as of 2026-09-07, confirmed live: other symbols return an empty
 * entries array, not an error). `limit` is 1-120 (confirmed live — NOT the same 1-40 bound as the other
 * history endpoints in this domain) and defaults to returning everything (no truncation) when omitted,
 * also unlike metric-history's default-20 behavior.
 *
 * `momChangePercent` is null on the earliest month in a symbol's series (nothing before it to compare
 * against) — confirmed on real 2330 data, its first backfilled month (2021-08) has a null
 * momChangePercent despite having a real yoyChangePercent.
 */
export async function fetchMonthlyRevenueHistory(symbol: string, limit?: number): Promise<MonthlyRevenueHistoryResult> {
  const searchParams: Record<string, string> = { symbol };
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }

  const url = buildAnalysisServiceUrl("/companies/monthly-revenue-history", searchParams);
  const response = await fetchAnalysisService(url);

  await assertAnalysisServiceOk(response, url, "Monthly revenue history endpoint");

  const body: unknown = await response.json();
  if (!isMonthlyRevenueHistoryResponse(body)) {
    logger.error({ url: url.toString() }, "Monthly revenue history endpoint response is missing an entries array");
    throw new AppError("Monthly revenue history endpoint response is missing an entries array", 502);
  }

  return { symbol, ...extractHistoryPageMeta(body), entries: body.entries.map(normalizeEntry) };
}
