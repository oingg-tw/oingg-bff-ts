import { AppError } from "@/shared/errorHandler.js";
import { requireEnv } from "@/shared/env.js";
import type {
  ForeignHoldingRankingEntry,
  ForeignHoldingRankingResult,
  MarginShortRatioRankingEntry,
  MarginShortRatioRankingResult,
} from "@/domains/market/market.types.js";

/** "" means "no data yet" (see ForeignHoldingRankingResult) — normalized to null, a clearer signal than an empty string. */
function toDateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return value;
}

/**
 * Ratio/percentage fields (Decimal-backed) come back from analysis-ts as JSON numbers — their real,
 * existing convention (confirmed with them directly, see analysisScreenerClient.ts's normalizeValues
 * for the same pattern) — normalized to strings here so bff-ts's own outward API stays consistent with
 * every other numeric value it returns. Raw balance/share-count fields are already strings on their side
 * (BigInt-backed), but String() is a safe no-op if a small value ever comes back as a number instead.
 */
function toStringOrEmpty(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function normalizeForeignHoldingEntry(raw: unknown): ForeignHoldingRankingEntry {
  const r = raw as Record<string, unknown>;
  return {
    symbol: String(r.symbol),
    sharesHeldPercent: toStringOrEmpty(r.sharesHeldPercent),
    previousSharesHeldPercent: toStringOrEmpty(r.previousSharesHeldPercent),
    changePercentagePoints: toStringOrEmpty(r.changePercentagePoints),
    sharesHeld: toStringOrEmpty(r.sharesHeld),
  };
}

function normalizeMarginShortRatioEntry(raw: unknown): MarginShortRatioRankingEntry {
  const r = raw as Record<string, unknown>;
  return {
    rank: Number(r.rank),
    symbol: String(r.symbol),
    shortToMarginRatioPct: toStringOrEmpty(r.shortToMarginRatioPct),
    marginTodayBalance: toStringOrEmpty(r.marginTodayBalance),
    shortTodayBalance: toStringOrEmpty(r.shortTodayBalance),
  };
}

async function getJson(path: string, searchParams: Record<string, string>): Promise<unknown> {
  const url = new URL(path, requireEnv("FILTERS_SERVICE_URL"));
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new AppError(
      `Could not reach the analysis service at ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }

  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    throw new AppError(typeof message === "string" ? message : `Invalid request to ${url.toString()}`, 400);
  }
  if (!response.ok) {
    throw new AppError(`Market ranking endpoint returned ${response.status} for ${url.toString()}`, 502);
  }
  return response.json();
}

/**
 * Foreign-holding increase/decrease ranking from analysis-ts's GET /market/foreign-holding-ranking —
 * compares the two most recent trading days' `sharesHeldPercent` (percentage of issued shares, not raw
 * share count, so capital increases/decreases don't distort the ranking), sorted by percentage-point
 * change. Both ETFs/derivatives and (currently) any symbol without two comparable days are excluded on
 * analysis-ts's side.
 */
export async function fetchForeignHoldingRanking(topPercent: number): Promise<ForeignHoldingRankingResult> {
  const body = (await getJson("/market/foreign-holding-ranking", { topPercent: String(topPercent) })) as {
    tradeDate?: unknown;
    previousTradeDate?: unknown;
    topPercent?: unknown;
    eligibleCompanyCount?: unknown;
    increases?: unknown;
    decreases?: unknown;
    warnings?: unknown;
  };

  if (
    typeof body.topPercent !== "number" ||
    typeof body.eligibleCompanyCount !== "number" ||
    !Array.isArray(body.increases) ||
    !Array.isArray(body.decreases)
  ) {
    throw new AppError("Foreign holding ranking response is missing expected fields", 502);
  }

  return {
    tradeDate: toDateOrNull(body.tradeDate),
    previousTradeDate: toDateOrNull(body.previousTradeDate),
    topPercent: body.topPercent,
    eligibleCompanyCount: body.eligibleCompanyCount,
    increases: body.increases.map(normalizeForeignHoldingEntry),
    decreases: body.decreases.map(normalizeForeignHoldingEntry),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}

/**
 * Margin/short ratio ranking (short-sale balance ÷ margin-purchase balance × 100) from analysis-ts's
 * GET /market/margin-short-ratio-ranking — a higher ratio signals more short-squeeze potential. Companies
 * with a zero margin balance or no short-sale data are excluded outright on analysis-ts's side (never
 * treated as 0 or Infinity). ETFs/derivatives are also excluded there.
 */
export async function fetchMarginShortRatioRanking(limit: number): Promise<MarginShortRatioRankingResult> {
  const body = (await getJson("/market/margin-short-ratio-ranking", { limit: String(limit) })) as {
    tradeDate?: unknown;
    limit?: unknown;
    rankings?: unknown;
    warnings?: unknown;
  };

  if (typeof body.limit !== "number" || !Array.isArray(body.rankings)) {
    throw new AppError("Margin/short ratio ranking response is missing expected fields", 502);
  }

  return {
    tradeDate: toDateOrNull(body.tradeDate),
    limit: body.limit,
    rankings: body.rankings.map(normalizeMarginShortRatioEntry),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}
