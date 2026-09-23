import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { Pagination } from "@/application/proxy/screener/pagination.js";
import type { ScreenerFilter, ScreenerValue } from "@/application/proxy/screener/screener.types.js";

export interface ScreenerColumnInput {
  field: string;
}

export interface AnalysisScreenerResultRow {
  symbol: string;
  /** analysis-ts attaches this directly as of 2026-09-01 — see normalizeRows. Null if they have no name on file. */
  name: string | null;
  values: Record<string, ScreenerValue>;
}

export interface AnalysisScreenerResult {
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  results: AnalysisScreenerResultRow[];
}

export interface AnalysisRankingResult {
  results: AnalysisScreenerResultRow[];
}

export interface AnalysisScreenerValuesResult {
  results: AnalysisScreenerResultRow[];
}

export interface AnalysisCompanyRankResult {
  symbol: string;
  field: string;
  found: boolean;
  value: number | null;
  rank: number | null;
  totalCount: number | null;
  topPercent: number | null;
}

export interface AnalysisDistributionBin {
  min: number;
  max: number;
  count: number;
}

export interface AnalysisDistributionResult {
  field: string;
  totalCount: number;
  trueMin: number;
  trueMax: number;
  clippedMin: number;
  clippedMax: number;
  bins: AnalysisDistributionBin[];
}

/**
 * analysis-ts sends ratio/percentage `value`s as JSON numbers (their real, existing convention for
 * Decimal-backed fields — confirmed with them directly, see stockQuote.client.ts's normalizeStockQuote
 * for the same pattern). bff-ts's own screener values have always been strings (an artifact of
 * node-postgres's default NUMERIC serialization from when this ran direct SQL, not a deliberate
 * convention either — but existing tests/frontend already depend on it), so normalize here to preserve
 * that regardless of the new backend.
 *
 * `asOfDate` was renamed to `knowledgeDate` by analysis-ts 2026-09-13 (commit 7549119) across POST
 * /screener, GET /screener/ranking, and POST /screener/values — a genuine semantic-clarity fix (the field
 * means "the day the market found out this value," not "the day it took effect"), and `nullReason` was
 * added alongside it (same 4-value convention as metric-history's nullReason: missing_input/
 * zero_or_negative_denominator/not_applicable_industry/insufficient_history). Mirrored into bff-ts's own
 * ScreenerValue type rather than just the wire format, per feedback_mirror_ubiquitous_language_renames —
 * this also brings the screener domain in line with every other bff-ts endpoint (metric-history,
 * roe-history, etc.), which already called this field knowledgeDate.
 */
function normalizeValues(values: Record<string, unknown>): Record<string, ScreenerValue> {
  const normalized: Record<string, ScreenerValue> = {};
  for (const [field, raw] of Object.entries(values)) {
    const v = raw as { value?: unknown; knowledgeDate?: unknown; nullReason?: unknown } | null;
    normalized[field] = {
      value: v?.value === null || v?.value === undefined ? null : String(v.value),
      knowledgeDate: v?.knowledgeDate === null || v?.knowledgeDate === undefined ? null : String(v.knowledgeDate),
      nullReason: v?.nullReason === null || v?.nullReason === undefined ? null : String(v.nullReason),
    };
  }
  return normalized;
}

function normalizeRows(rows: unknown): AnalysisScreenerResultRow[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row) => {
    const r = row as { symbol?: unknown; companyName?: unknown; values?: unknown };
    return {
      symbol: String(r.symbol),
      name: typeof r.companyName === "string" ? r.companyName : null,
      values: normalizeValues((r.values ?? {}) as Record<string, unknown>),
    };
  });
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const url = buildAnalysisServiceUrl(path);
  const response = await fetchAnalysisService(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleJsonResponse(response, url);
}

async function getJson(path: string, searchParams: Record<string, string>): Promise<unknown> {
  const url = buildAnalysisServiceUrl(path, searchParams);
  const response = await fetchAnalysisService(url);
  return handleJsonResponse(response, url);
}

/**
 * analysis-ts's screener endpoints return a plain `{ message }` 400 for an unknown/invalid field (their
 * error envelope, not bff-ts's own `{ error: { message } }`) — relayed here as a 400 AppError with their
 * message, since it's already a caller-facing, actionable error (bad field name), not an internal detail
 * to hide. Any other non-2xx is treated as an upstream failure (502).
 */
async function handleJsonResponse(response: Response, url: URL): Promise<unknown> {
  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== "string") {
      logger.error({ url: url.toString() }, "Invalid screener request, no message in response body");
    }
    throw new AppError(typeof message === "string" ? message : "Invalid screener request", 400);
  }
  assertAnalysisServiceOk(response, url, "Screener endpoint");
  return response.json();
}

export interface ScreenerSort {
  field: string;
  order: "asc" | "desc";
}

/**
 * Runs the full filtered/paginated screener against analysis-ts's POST /screener — the field-resolution
 * (catalog validation, metricName/fieldName for display) and "stock.price"/company-name merging still
 * happen on bff-ts's side (see screener.service.ts); this client only talks to the endpoint that now
 * owns the actual query engine (dynamic CTE/JOIN across 30+ metric tables, latest-row-per-symbol,
 * ROC-year quarter labels, sorting, etc. — see docs/直連DB反模式修復計畫.md for what moved). Sorting is
 * full-result-set (applied before pagination on their side), not just within the returned page — they
 * also add `symbol` as a stable tiebreaker internally when the sort field has duplicate values.
 */
export async function fetchScreenerResults(
  filters: ScreenerFilter[],
  columns: ScreenerColumnInput[],
  pagination: Pagination,
  sort?: ScreenerSort,
  sectorCodes?: string[],
  excludeSectorCodes?: string[],
): Promise<AnalysisScreenerResult> {
  const body = await postJson("/screener", {
    filters,
    columns,
    page: pagination.page,
    pageSize: pagination.pageSize,
    ...(sort ? { sortField: sort.field, sortOrder: sort.order } : {}),
    ...(sectorCodes && sectorCodes.length > 0 ? { sectorCodes } : {}),
    ...(excludeSectorCodes && excludeSectorCodes.length > 0 ? { excludeSectorCodes } : {}),
  });

  const b = body as { count?: unknown; page?: unknown; pageSize?: unknown; totalPages?: unknown; results?: unknown };
  if (
    typeof b.count !== "number" ||
    typeof b.page !== "number" ||
    typeof b.pageSize !== "number" ||
    typeof b.totalPages !== "number" ||
    !Array.isArray(b.results)
  ) {
    throw new AppError("Screener endpoint response is missing count/page/pageSize/totalPages/results", 502);
  }

  return { count: b.count, page: b.page, pageSize: b.pageSize, totalPages: b.totalPages, results: normalizeRows(b.results) };
}

/**
 * Runs a single-metric ranking against analysis-ts's GET /screener/ranking. The ranked `field` always
 * comes back in each row's `values` (analysis-ts's deliberate asymmetry vs. POST /screener, confirmed
 * with them directly) — `extraColumns` are additional display fields, same comma-separated query param
 * bff-ts's own GET /screener/ranking route already accepts from its callers.
 */
export async function fetchScreenerRanking(
  field: string,
  direction: "asc" | "desc",
  limit: number,
  extraColumns: ScreenerColumnInput[],
  sectorCodes?: string[],
  excludeSectorCodes?: string[],
): Promise<AnalysisRankingResult> {
  const body = await getJson("/screener/ranking", {
    field,
    direction,
    limit: String(limit),
    ...(extraColumns.length > 0 ? { columns: extraColumns.map((c) => c.field).join(",") } : {}),
    ...(sectorCodes && sectorCodes.length > 0 ? { sectorCodes: sectorCodes.join(",") } : {}),
    ...(excludeSectorCodes && excludeSectorCodes.length > 0 ? { excludeSectorCodes: excludeSectorCodes.join(",") } : {}),
  });

  const b = body as { results?: unknown };
  if (!Array.isArray(b.results)) {
    throw new AppError("Screener ranking endpoint response is missing a results array", 502);
  }

  return { results: normalizeRows(b.results) };
}

/**
 * Fetches just the requested columns for an explicit, already-known list of symbols, against
 * analysis-ts's POST /screener/values — used when the frontend adds a new column to an already-loaded
 * result set, so it doesn't need to re-run the full filtered/paginated query (and re-fetch every column
 * it already has) just to pick up one more field. No filters, no pagination — see runScreenerValues in
 * screener.service.ts.
 */
export async function fetchScreenerValues(
  symbols: string[],
  columns: ScreenerColumnInput[],
): Promise<AnalysisScreenerValuesResult> {
  const body = await postJson("/screener/values", { symbols, columns });

  const b = body as { results?: unknown };
  if (!Array.isArray(b.results)) {
    throw new AppError("Screener values endpoint response is missing a results array", 502);
  }

  return { results: normalizeRows(b.results) };
}

/**
 * Fetches one company's rank/percentile against the whole market for a single field, from analysis-ts's
 * GET /screener/company-rank — added 2026-09-16, complementing GET /screener/ranking ("who's in the top
 * N") with the reverse question ("where does THIS company rank") without the caller having to fetch a
 * full ranking list and count through it themselves.
 *
 * `rank` is 1-based and RANK()-style (ties share a rank, so a following rank can skip numbers). `direction`
 * is required upstream (no default — confirmed live, omitting it 400s) — desc means higher values rank
 * better. `totalCount` only counts companies with a non-null value for this field. `topPercent` =
 * rank÷totalCount×100, rounded to 1 decimal — a SMALLER topPercent means a BETTER rank (e.g. 5 means "top
 * 5% of the market"), the opposite direction from an ordinary percentile. `found: false` (the field has no
 * data for this symbol, or the symbol itself doesn't exist) still returns 200 with value/rank/totalCount/
 * topPercent all null, not a 404 — confirmed live, same convention as this domain's other per-symbol calls.
 */
export async function fetchCompanyRank(
  symbol: string,
  field: string,
  direction: "asc" | "desc",
): Promise<AnalysisCompanyRankResult> {
  const body = await getJson("/screener/company-rank", { symbol, field, direction });

  const b = body as { symbol?: unknown; field?: unknown; found?: unknown; value?: unknown; rank?: unknown; totalCount?: unknown; topPercent?: unknown };
  if (typeof b.symbol !== "string" || typeof b.field !== "string" || typeof b.found !== "boolean") {
    throw new AppError("Company rank endpoint response is missing symbol/field/found", 502);
  }

  return {
    symbol: b.symbol,
    field: b.field,
    found: b.found,
    value: typeof b.value === "number" ? b.value : null,
    rank: typeof b.rank === "number" ? b.rank : null,
    totalCount: typeof b.totalCount === "number" ? b.totalCount : null,
    topPercent: typeof b.topPercent === "number" ? b.topPercent : null,
  };
}

/**
 * Fetches the whole market's distribution for a single field, from analysis-ts's GET /screener/distribution
 * — added 2026-09-18 for a market-wide histogram (e.g. 現金殖利率的市場排名 on a stock-detail card). Pure
 * pass-through, same convention as fetchCompanyRank: field validation is delegated to analysis-ts itself,
 * this client only shape-checks the response.
 */
export async function fetchDistribution(
  field: string,
  bins: number | undefined,
  excludeZero: boolean | undefined,
): Promise<AnalysisDistributionResult> {
  const body = await getJson("/screener/distribution", {
    field,
    ...(bins !== undefined ? { bins: String(bins) } : {}),
    ...(excludeZero !== undefined ? { excludeZero: String(excludeZero) } : {}),
  });

  const b = body as {
    field?: unknown;
    totalCount?: unknown;
    trueMin?: unknown;
    trueMax?: unknown;
    clippedMin?: unknown;
    clippedMax?: unknown;
    bins?: unknown;
  };
  if (
    typeof b.field !== "string" ||
    typeof b.totalCount !== "number" ||
    typeof b.trueMin !== "number" ||
    typeof b.trueMax !== "number" ||
    typeof b.clippedMin !== "number" ||
    typeof b.clippedMax !== "number" ||
    !Array.isArray(b.bins)
  ) {
    throw new AppError("Distribution endpoint response is missing field/totalCount/trueMin/trueMax/clippedMin/clippedMax/bins", 502);
  }

  return {
    field: b.field,
    totalCount: b.totalCount,
    trueMin: b.trueMin,
    trueMax: b.trueMax,
    clippedMin: b.clippedMin,
    clippedMax: b.clippedMax,
    bins: b.bins.map((bin) => {
      const raw = bin as { min?: unknown; max?: unknown; count?: unknown };
      if (typeof raw.min !== "number" || typeof raw.max !== "number" || typeof raw.count !== "number") {
        throw new AppError("Distribution endpoint response has a bin missing min/max/count", 502);
      }
      return { min: raw.min, max: raw.max, count: raw.count };
    }),
  };
}
