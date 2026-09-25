import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { DividendEvent, DividendHistoryEntry, DividendHistoryResult } from "@/application/proxy/stock/dividendHistory.types.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeEvent(raw: unknown): DividendEvent {
  const r = raw as Record<string, unknown>;
  return {
    fiscalQuarter: toNumberOrNull(r.fiscalQuarter),
    cashDividend: Number(r.cashDividend),
    // toNumberOrNull 而不是 Number()：欄位缺席時 Number(undefined) 是 NaN，序列化成 null 但型別說是
    // number——那是意外對了。用 toNumberOrNull 讓 null 成為一個被宣告的狀態，而 0 保持是 0。
    cashDividendFromEarnings: toNumberOrNull(r.cashDividendFromEarnings),
    cashDividendFromLegalReserveAndCapitalSurplus: toNumberOrNull(r.cashDividendFromLegalReserveAndCapitalSurplus),
    stockDividend: Number(r.stockDividend),
    exDividendDate: toStringOrNull(r.exDividendDate),
    exRightsDate: toStringOrNull(r.exRightsDate),
    paymentDate: toStringOrNull(r.paymentDate),
    announcementDate: String(r.announcementDate),
    closeAtExDate: toNumberOrNull(r.closeAtExDate),
    yieldAtExDate: toNumberOrNull(r.yieldAtExDate),
  };
}

function normalizeEntry(raw: unknown): DividendHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    fiscalYear: Number(r.fiscalYear),
    rocFiscalYear: Number(r.rocFiscalYear),
    cashDividend: Number(r.cashDividend),
    // toNumberOrNull 而不是 Number()：欄位缺席時 Number(undefined) 是 NaN，序列化成 null 但型別說是
    // number——那是意外對了。用 toNumberOrNull 讓 null 成為一個被宣告的狀態，而 0 保持是 0。
    cashDividendFromEarnings: toNumberOrNull(r.cashDividendFromEarnings),
    cashDividendFromLegalReserveAndCapitalSurplus: toNumberOrNull(r.cashDividendFromLegalReserveAndCapitalSurplus),
    stockDividend: Number(r.stockDividend),
    totalDividend: Number(r.totalDividend),
    distributionCount: Number(r.distributionCount),
    exDividendDate: toStringOrNull(r.exDividendDate),
    exRightsDate: toStringOrNull(r.exRightsDate),
    paymentDate: toStringOrNull(r.paymentDate),
    eps: toNumberOrNull(r.eps),
    payoutRatio: toNumberOrNull(r.payoutRatio),
    yieldAtExDate: toNumberOrNull(r.yieldAtExDate),
    knowledgeDate: String(r.knowledgeDate),
    events: Array.isArray(r.events) ? r.events.map(normalizeEvent) : [],
  };
}

function isDividendHistoryResponse(body: unknown): body is { symbol?: unknown; entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches a company's fiscal-year dividend history from analysis-ts's GET /companies/dividend-history?symbol=,
 * added 2026-09-19 for web-nuxt's SEO content thickening (歷年股利表). Oldest to newest (opposite order
 * from capital-stock-history's newest-to-oldest — confirmed live). Always 200, never 404 — an unknown or
 * no-data symbol just gets back an empty `entries` array, same convention as capital-stock-history.
 */
export async function fetchDividendHistory(symbol: string): Promise<DividendHistoryResult> {
  const url = buildAnalysisServiceUrl("/companies/dividend-history", { symbol });
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Dividend history endpoint");

  const body: unknown = await response.json();
  if (!isDividendHistoryResponse(body)) {
    logger.error({ url: url.toString() }, "Dividend history endpoint response is missing an entries array");
    throw new AppError("Dividend history endpoint response is missing an entries array", 502);
  }

  return {
    symbol: typeof body.symbol === "string" ? body.symbol : symbol,
    entries: body.entries.map(normalizeEntry),
  };
}
