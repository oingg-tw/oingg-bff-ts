import { AppError } from "@/shared/errorHandler.js";
import { requireEnv } from "@/shared/env.js";
import type { Pagination } from "@/domains/screener/pagination.js";
import type { ScreenerFilter, ScreenerValue } from "@/domains/screener/screener.types.js";

export interface ScreenerColumnInput {
  field: string;
}

export interface AnalysisScreenerResultRow {
  symbol: string;
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

/**
 * analysis-ts sends ratio/percentage `value`s as JSON numbers (their real, existing convention for
 * Decimal-backed fields — confirmed with them directly, see stockQuote.client.ts's normalizeStockQuote
 * for the same pattern). bff-ts's own screener values have always been strings (an artifact of
 * node-postgres's default NUMERIC serialization from when this ran direct SQL, not a deliberate
 * convention either — but existing tests/frontend already depend on it), so normalize here to preserve
 * that regardless of the new backend.
 */
function normalizeValues(values: Record<string, unknown>): Record<string, ScreenerValue> {
  const normalized: Record<string, ScreenerValue> = {};
  for (const [field, raw] of Object.entries(values)) {
    const v = raw as { value?: unknown; asOfDate?: unknown } | null;
    normalized[field] = {
      value: v?.value === null || v?.value === undefined ? null : String(v.value),
      asOfDate: v?.asOfDate === null || v?.asOfDate === undefined ? null : String(v.asOfDate),
    };
  }
  return normalized;
}

function normalizeRows(rows: unknown): AnalysisScreenerResultRow[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row) => {
    const r = row as { symbol?: unknown; values?: unknown };
    return {
      symbol: String(r.symbol),
      values: normalizeValues((r.values ?? {}) as Record<string, unknown>),
    };
  });
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const url = new URL(path, requireEnv("FILTERS_SERVICE_URL"));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new AppError(
      `Could not reach the analysis service at ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }
  return handleJsonResponse(response, url);
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
    throw new AppError(typeof message === "string" ? message : `Invalid screener request to ${url.toString()}`, 400);
  }
  if (!response.ok) {
    throw new AppError(`Screener endpoint returned ${response.status} for ${url.toString()}`, 502);
  }
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
): Promise<AnalysisScreenerResult> {
  const body = await postJson("/screener", {
    filters,
    columns,
    page: pagination.page,
    pageSize: pagination.pageSize,
    ...(sort ? { sortField: sort.field, sortOrder: sort.order } : {}),
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
): Promise<AnalysisRankingResult> {
  const body = await getJson("/screener/ranking", {
    field,
    direction,
    limit: String(limit),
    ...(extraColumns.length > 0 ? { columns: extraColumns.map((c) => c.field).join(",") } : {}),
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
