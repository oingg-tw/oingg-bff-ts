import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  ForeignShareholdingHistoryEntry,
  ForeignShareholdingHistoryResult,
} from "@/application/proxy/stock/foreignShareholdingHistory.types.js";

function normalizeEntry(raw: unknown): ForeignShareholdingHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    tradeDate: String(r.tradeDate),
    sharesHeldPercent: Number(r.sharesHeldPercent),
    foreignLimitPercent: Number(r.foreignLimitPercent),
    availableInvestPercent: Number(r.availableInvestPercent),
  };
}

function isForeignShareholdingHistoryResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches daily foreign-shareholding-percentage history from analysis-ts's own
 * GET /stocks/:symbol/foreign-shareholding-history — unlike the other history endpoints in this domain,
 * analysis-ts already used the "/stocks/:symbol/..." path itself (confirmed live, 2026-09-08), so this
 * is the one client here that doesn't go through /companies/xxx-history?symbol=. No `basis` param. `limit`
 * bounds are 1-1500 (confirmed live); omitting it defaults to 250 entries, NOT "everything" (confirmed:
 * limit=1500 for 2330 returned 1224 entries reaching back to 2021, vs. 250 with no limit reaching back to
 * only 2025-08). No total/hasMore fields in the response, unlike metric/roe/roa/dupont/monthly-revenue-
 * history — checked directly rather than assumed. An unknown symbol returns `entries: []`, not a 404.
 */
export async function fetchForeignShareholdingHistory(symbol: string, limit?: number): Promise<ForeignShareholdingHistoryResult> {
  const searchParams: Record<string, string> = {};
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }

  const url = buildAnalysisServiceUrl(`/stocks/${encodeURIComponent(symbol)}/foreign-shareholding-history`, searchParams);
  const response = await fetchAnalysisService(url);

  await assertAnalysisServiceOk(response, url, "Foreign shareholding history endpoint");

  const body: unknown = await response.json();
  if (!isForeignShareholdingHistoryResponse(body)) {
    logger.error({ url: url.toString() }, "Foreign shareholding history endpoint response is missing an entries array");
    throw new AppError("Foreign shareholding history endpoint response is missing an entries array", 502);
  }

  return { symbol, entries: body.entries.map(normalizeEntry) };
}
