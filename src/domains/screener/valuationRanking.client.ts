import { AppError } from "@/shared/errorHandler.js";
import { requireEnv } from "@/shared/env.js";

export type ValuationRankingMetric = "peRatio" | "pbRatio" | "dividendYield";

export interface ValuationRankingRow {
  symbol: string;
  name: string | null;
  value: number;
}

export interface ValuationRankingResult {
  /** The trading day this whole ranking is computed as of — one date for the entire ranking, not per-row. */
  tradeDate: string | null;
  rankings: ValuationRankingRow[];
}

interface RawValuationRankingResponse {
  tradeDate?: unknown;
  rankings: unknown[];
}

function isAnalysisRankingResponse(body: unknown): body is RawValuationRankingResponse {
  if (typeof body !== "object" || body === null) return false;
  const { rankings, tradeDate } = body as { rankings?: unknown; tradeDate?: unknown };
  return Array.isArray(rankings) && (typeof tradeDate === "string" || tradeDate === null || tradeDate === undefined);
}

function normalizeValuationRankingRow(raw: unknown): ValuationRankingRow {
  const r = raw as { symbol?: unknown; companyName?: unknown; value?: unknown };
  return {
    symbol: String(r.symbol),
    name: typeof r.companyName === "string" ? r.companyName : null,
    value: Number(r.value),
  };
}

/**
 * Ranking is a second-order computation over raw market data (sort, limit, exclude non-positive P/E or
 * P/B) — oingg-analysis-ts's job, not this BFF's. Calls its GET /valuation/ranking (same
 * FILTERS_SERVICE_URL host already used for the filter catalog) instead of this service querying
 * twse/tpex's daily_valuation and reimplementing that logic itself — keeps the BFF doing what a BFF is
 * for (shaping data for a specific frontend use case), not owning business logic that already has an
 * owner elsewhere in the ecosystem.
 */
export async function fetchValuationRanking(
  metric: ValuationRankingMetric,
  order: "asc" | "desc",
  limit: number,
): Promise<ValuationRankingResult> {
  const url = new URL("/valuation/ranking", requireEnv("FILTERS_SERVICE_URL"));
  url.searchParams.set("metric", metric);
  url.searchParams.set("order", order);
  url.searchParams.set("limit", String(limit));

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    // fetch() itself throws (not a rejected-but-caught HTTP response) for connection-level failures —
    // refused/unreachable host, DNS, timeout. Without this, that surfaces as a generic uncaught 500
    // ("Internal server error") instead of a clear "the analysis service is down" 502.
    throw new AppError(
      `Could not reach the analysis service at ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }
  if (!response.ok) {
    throw new AppError(`Analysis service returned ${response.status} for ${url.toString()}`, 502);
  }

  const body: unknown = await response.json();
  if (!isAnalysisRankingResponse(body)) {
    throw new AppError(`Analysis service response at ${url.toString()} is missing a "rankings" array`, 502);
  }

  return { tradeDate: (body.tradeDate as string | undefined) ?? null, rankings: body.rankings.map(normalizeValuationRankingRow) };
}
