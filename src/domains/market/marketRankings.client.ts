import { AppError } from "@/shared/errorHandler.js";
import { requireEnv } from "@/shared/env.js";
import type {
  ForeignHoldingRankingEntry,
  ForeignHoldingRankingResult,
  MarginShortRatioRankingEntry,
  MarginShortRatioRankingResult,
  MaterialAnnouncementEntry,
  MaterialAnnouncementsResult,
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
    name: typeof r.companyName === "string" ? r.companyName : null,
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
    name: typeof r.companyName === "string" ? r.companyName : null,
    shortToMarginRatioPct: toStringOrEmpty(r.shortToMarginRatioPct),
    marginTodayBalance: toStringOrEmpty(r.marginTodayBalance),
    shortTodayBalance: toStringOrEmpty(r.shortTodayBalance),
  };
}

function normalizeMaterialAnnouncementEntry(raw: unknown): MaterialAnnouncementEntry {
  const r = raw as Record<string, unknown>;
  return {
    symbol: String(r.symbol),
    name: typeof r.companyName === "string" ? r.companyName : null,
    announcementDate: toStringOrEmpty(r.announcementDate),
    announcementTime: toStringOrEmpty(r.announcementTime),
    reportDate: toStringOrEmpty(r.reportDate),
    subject: toStringOrEmpty(r.subject),
    clause: toStringOrEmpty(r.clause),
    factDate: toStringOrEmpty(r.factDate),
    description: toStringOrEmpty(r.description),
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
 *
 * `limit` (top N rows per direction) replaced the endpoint's original `topPercent` (top N% after sorting)
 * param as of 2026-09-01 — analysis-ts switched their own query semantics to a fixed row count, matching
 * margin-short-ratio-ranking's convention, so bff-ts's param/field naming follows suit here too.
 */
export async function fetchForeignHoldingRanking(limit: number): Promise<ForeignHoldingRankingResult> {
  const body = (await getJson("/market/foreign-holding-ranking", { limit: String(limit) })) as {
    tradeDate?: unknown;
    previousTradeDate?: unknown;
    limit?: unknown;
    eligibleCompanyCount?: unknown;
    increases?: unknown;
    decreases?: unknown;
    warnings?: unknown;
  };

  if (
    typeof body.limit !== "number" ||
    typeof body.eligibleCompanyCount !== "number" ||
    !Array.isArray(body.increases) ||
    !Array.isArray(body.decreases)
  ) {
    throw new AppError("Foreign holding ranking response is missing expected fields", 502);
  }

  return {
    tradeDate: toDateOrNull(body.tradeDate),
    previousTradeDate: toDateOrNull(body.previousTradeDate),
    limit: body.limit,
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

/**
 * 上市公司重大訊息公告 from analysis-ts's GET /market/material-announcements — newest announcement date
 * first. Unlike this file's other endpoints, twse-ts's schedule for this dataset has been stable for a
 * while, so prod already has real data (confirmed live: 254 rows) — no deploy wait needed here.
 */
export async function fetchMaterialAnnouncements(limit: number): Promise<MaterialAnnouncementsResult> {
  const body = (await getJson("/market/material-announcements", { limit: String(limit) })) as {
    limit?: unknown;
    items?: unknown;
    warnings?: unknown;
  };

  if (typeof body.limit !== "number" || !Array.isArray(body.items)) {
    throw new AppError("Material announcements response is missing expected fields", 502);
  }

  return {
    limit: body.limit,
    items: body.items.map(normalizeMaterialAnnouncementEntry),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}
