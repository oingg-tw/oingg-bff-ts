import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { BetaResult, BetaTimeframe, BetaWindow } from "@/domainBff/stock/beta.types.js";

const VALID_TIMEFRAMES: BetaTimeframe[] = ["1Y_1D", "2Y_1W", "5Y_1M"];

function isBetaTimeframe(value: unknown): value is BetaTimeframe {
  return typeof value === "string" && (VALID_TIMEFRAMES as string[]).includes(value);
}

function normalizeWindow(raw: unknown): BetaWindow {
  const r = raw as Record<string, unknown>;
  if (!isBetaTimeframe(r.timeframe)) {
    throw new AppError(`Beta endpoint response has an unrecognized timeframe: ${String(r.timeframe)}`, 502);
  }
  return {
    timeframe: r.timeframe,
    value: typeof r.value === "number" ? r.value : null,
    nullReason: typeof r.nullReason === "string" ? r.nullReason : null,
    tradeDate: typeof r.tradeDate === "string" ? r.tradeDate : null,
    knowledgeDate: typeof r.knowledgeDate === "string" ? r.knowledgeDate : null,
    knowledgeDateIsFallback: typeof r.knowledgeDateIsFallback === "boolean" ? r.knowledgeDateIsFallback : null,
  };
}

/**
 * Fetches a symbol's Beta coefficient across all 3 of analysis-ts's fixed windows from
 * GET /companies/beta?symbol= — always exactly 3 windows (1Y_1D/2Y_1W/5Y_1M) in that order. An unknown or
 * not-yet-backfilled symbol comes back 200 with every window's value/nullReason/tradeDate/knowledgeDate/
 * knowledgeDateIsFallback null, not a 404 (confirmed live) — same "never 404, just all-null" convention as
 * this domain's other history endpoints.
 */
export async function fetchBeta(symbol: string): Promise<BetaResult> {
  const url = buildAnalysisServiceUrl("/companies/beta", { symbol });
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Beta endpoint");

  const body: unknown = await response.json();
  const b = body as { symbol?: unknown; windows?: unknown };
  if (typeof b.symbol !== "string" || !Array.isArray(b.windows)) {
    logger.error({ url: url.toString() }, "Beta endpoint response is missing symbol/windows");
    throw new AppError("Beta endpoint response is missing symbol/windows", 502);
  }

  return { symbol: b.symbol, windows: b.windows.map(normalizeWindow) };
}
