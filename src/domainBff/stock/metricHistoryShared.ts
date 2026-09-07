import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";

export interface FlatHistoryEntry {
  fiscalYear: number;
  fiscalQuarter: number;
  /** Null when the underlying figure couldn't be computed for this quarter — see nullReason. */
  value: number | null;
  /** Why `value` is null (e.g. a missing trailing quarter of data) — null when `value` is present. */
  nullReason: string | null;
  /** The financial-report announcement date this figure is aligned to — not a daily market-data date. */
  knowledgeDate: string;
  /** True when knowledgeDate is a fallback estimate rather than the real announcement date. */
  knowledgeDateIsFallback: boolean;
}

/**
 * Pagination metadata analysis-ts added to every history endpoint in this domain (2026-09-07, same day
 * as the endpoints themselves — not present in the very first responses this codebase saw, which is why
 * it was initially missed on 3 of the 5 endpoints until web-nuxt's tenYearDisabled UI logic surfaced the
 * gap). `total` is the full count available (not just what this page returned); `hasMore` is whether a
 * higher `limit` would return more entries than this call did.
 */
export interface HistoryPageMeta {
  total: number;
  hasMore: boolean;
}

export type FlatHistoryPage = HistoryPageMeta & { entries: FlatHistoryEntry[] };

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeFlatHistoryEntry(raw: unknown): FlatHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    fiscalYear: Number(r.fiscalYear),
    fiscalQuarter: Number(r.fiscalQuarter),
    value: toNumberOrNull(r.value),
    nullReason: toStringOrNull(r.nullReason),
    knowledgeDate: String(r.knowledgeDate),
    knowledgeDateIsFallback: r.knowledgeDateIsFallback === true,
  };
}

function isFlatHistoryResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * `total`/`hasMore` are read the same way across every history endpoint in this domain (including
 * dupont-history and monthly-revenue-history, which don't use fetchFlatMetricHistory below since their
 * entry shape differs) — pulled out so all 5 clients extract them identically instead of duplicating
 * the same two-line cast.
 */
export function extractHistoryPageMeta(body: Record<string, unknown>): HistoryPageMeta {
  return {
    total: typeof body.total === "number" ? body.total : 0,
    hasMore: body.hasMore === true,
  };
}

/**
 * Shared fetch+normalize logic for analysis-ts's family of "one quarterly figure per entry" history
 * endpoints (metric-history, roe-history, roa-history) — all share the identical entry shape, differing
 * only in URL path and which basis values each accepts (confirmed live, 2026-09-07: metric-history's
 * basis validity varies per metricCode, roe/roa allow Q/Q_ANN/TTM). Relays analysis-ts's own 400 message
 * as-is (e.g. an invalid basis for that specific endpoint) rather than masking it as a generic 502, same
 * pattern as etfScreener.client.ts's handleJsonResponse. dupont-history is NOT part of this family — it
 * has a genuinely different entry shape (multiple decomposed figures per quarter, not one `value`), see
 * dupontHistory.client.ts.
 */
export async function fetchFlatMetricHistory(
  path: string,
  searchParams: Record<string, string>,
  label: string,
): Promise<FlatHistoryPage> {
  const url = buildAnalysisServiceUrl(path, searchParams);
  const response = await fetchAnalysisService(url);

  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== "string") {
      logger.error({ url: url.toString() }, `Invalid ${label} request, no message in response body`);
    }
    throw new AppError(typeof message === "string" ? message : `Invalid ${label} request`, 400);
  }
  assertAnalysisServiceOk(response, url, `${label} endpoint`);

  const body: unknown = await response.json();
  if (!isFlatHistoryResponse(body)) {
    logger.error({ url: url.toString() }, `${label} endpoint response is missing an entries array`);
    throw new AppError(`${label} endpoint response is missing an entries array`, 502);
  }

  return {
    ...extractHistoryPageMeta(body),
    entries: body.entries.map(normalizeFlatHistoryEntry),
  };
}
