import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { DailyPriceHistoryEntry, DailyPriceHistoryResult } from "@/domainBff/stock/dailyPriceHistory.types.js";

function normalizeEntry(raw: unknown): DailyPriceHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    tradeDate: String(r.tradeDate),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  };
}

function isDailyPriceHistoryResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches daily OHLCV price history from analysis-ts's own GET /stocks/:symbol/daily-price-history —
 * same "/stocks/:symbol/..." path/limit convention as foreign-shareholding-history (added the same domain
 * pattern, 2026-09-10). `limit` bounds are 1-2000 (confirmed live); omitting it defaults to 250 entries,
 * not "everything" — confirmed: no-limit for 2330 returned exactly 250 entries reaching back to
 * 2025-08-28. Entries are oldest-to-newest (opposite of foreign-shareholding-history — confirmed live, do
 * not assume the two share ordering just because they share the path convention). An unknown symbol
 * returns `entries: []`, not a 404.
 */
export async function fetchDailyPriceHistory(symbol: string, limit?: number): Promise<DailyPriceHistoryResult> {
  const searchParams: Record<string, string> = {};
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }

  const url = buildAnalysisServiceUrl(`/stocks/${encodeURIComponent(symbol)}/daily-price-history`, searchParams);
  const response = await fetchAnalysisService(url);

  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== "string") {
      logger.error({ url: url.toString() }, "Invalid daily price history request, no message in response body");
    }
    throw new AppError(typeof message === "string" ? message : "Invalid daily price history request", 400);
  }
  assertAnalysisServiceOk(response, url, "Daily price history endpoint");

  const body: unknown = await response.json();
  if (!isDailyPriceHistoryResponse(body)) {
    logger.error({ url: url.toString() }, "Daily price history endpoint response is missing an entries array");
    throw new AppError("Daily price history endpoint response is missing an entries array", 502);
  }

  return { symbol, entries: body.entries.map(normalizeEntry) };
}
