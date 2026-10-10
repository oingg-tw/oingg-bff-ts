import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { fetchValuationRanking } from "@/infrastructure/analysisApi/screener/valuationRanking.client.js";
import type { Pagination } from "@/application/proxy/screener/pagination.js";
import type {
  CompanyRankResult,
  DistributionQuantiles,
  DistributionResult,
  ScreenerColumnRef,
  ScreenerFilter,
  ScreenerGatewayResult,
  ScreenerGatewayRow,
  ScreenerRankingGatewayResult,
  ScreenerSort,
  ScreenerValue,
  ScreenerValuesGatewayResult,
} from "@/application/proxy/screener/screener.types.js";
import type { ScreenerGatewayPort } from "@/application/ports/screenerGateway.js";

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
    const v = raw as { value?: unknown; knowledgeDate?: unknown; nullReason?: unknown; formulaVersion?: unknown } | null;
    normalized[field] = {
      value: v?.value === null || v?.value === undefined ? null : String(v.value),
      knowledgeDate: v?.knowledgeDate === null || v?.knowledgeDate === undefined ? null : String(v.knowledgeDate),
      nullReason: v?.nullReason === null || v?.nullReason === undefined ? null : String(v.nullReason),
      formulaVersion: typeof v?.formulaVersion === "number" && Number.isFinite(v.formulaVersion) ? v.formulaVersion : null,
    };
  }
  return normalized;
}

function normalizeRows(rows: unknown): ScreenerGatewayRow[] {
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
  await assertAnalysisServiceOk(response, url, "Screener endpoint");
  return response.json();
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
  columns: ScreenerColumnRef[],
  pagination: Pagination,
  sort?: ScreenerSort,
  sectorCodes?: string[],
  excludeSectorCodes?: string[],
): Promise<ScreenerGatewayResult> {
  const body = await postJson("/screener", {
    filters,
    columns,
    page: pagination.page,
    pageSize: pagination.pageSize,
    ...(sort ? { sortField: sort.field, order: sort.order } : {}), // 上游 810da900 起叫 order（sortOrder 2026-10-24 移除）
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
  extraColumns: ScreenerColumnRef[],
  sectorCodes?: string[],
  excludeSectorCodes?: string[],
): Promise<ScreenerRankingGatewayResult> {
  const body = await getJson("/screener/ranking", {
    field,
    order: direction, // 上游 810da900 起叫 order（direction 2026-10-24 移除）
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
  columns: ScreenerColumnRef[],
): Promise<ScreenerValuesGatewayResult> {
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
 * better. `totalCount` only counts companies with a non-null value for this field. `topPct` =
 * rank÷totalCount×100, rounded to 1 decimal — a SMALLER topPct means a BETTER rank (e.g. 5 means "top
 * 5% of the market"), the opposite direction from an ordinary percentile. `found: false` (the field has no
 * data for this symbol, or the symbol itself doesn't exist) still returns 200 with value/rank/totalCount/
 * topPct all null, not a 404 — confirmed live, same convention as this domain's other per-symbol calls.
 */
/**
 * analysis-ts 對 excludeZero 的解析是「有給就算數」，不是布林剖析——實測 2026-09-24：`excludeZero=false`
 * 跟 `excludeZero=0`、`excludeZero=bogus` 一樣都會排除零值，只有整個參數不存在（或空字串）才不排除。
 *
 * 所以這裡**只在 true 的時候送出這個參數**，false 一律省略。這不是替上游決定語意，而是讓我們自己文件上
 * 寫的「省略時等同 false」變成真的：呼叫端明講 false 卻拿到排除後的母體，是最惡劣的一種錯——數字看起來
 * 完全合理，只是回答了另一個問題。已回報上游，他們修好之後這個寫法仍然正確（true 照送、false 不送）。
 */
function excludeZeroParam(excludeZero: boolean | undefined): Record<string, string> {
  return excludeZero === true ? { excludeZero: "true" } : {};
}

export async function fetchCompanyRank(
  symbol: string,
  field: string,
  direction: "asc" | "desc",
  excludeZero: boolean | undefined,
): Promise<CompanyRankResult> {
  const body = await getJson("/screener/company-rank", { symbol, field, order: direction, ...excludeZeroParam(excludeZero) });

  const b = body as { symbol?: unknown; field?: unknown; found?: unknown; value?: unknown; rank?: unknown; totalCount?: unknown; topPct?: unknown; topPercent?: unknown; quintile?: unknown };
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
    topPct: typeof (b.topPct ?? b.topPercent) === "number" ? ((b.topPct ?? b.topPercent) as number) : null,
    quintile: typeof b.quintile === "number" ? b.quintile : null,
  };
}

/**
 * Fetches the whole market's distribution for a single field, from analysis-ts's GET /screener/distribution
 * — added 2026-09-18 for a market-wide histogram (e.g. 現金殖利率的市場排名 on a stock-detail card). Pure
 * pass-through, same convention as fetchCompanyRank: field validation is delegated to analysis-ts itself,
 * this client only shape-checks the response.
 */
function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** All four boundaries or nothing — a partial set would let a caller label an axis with gaps. */
function normalizeQuantiles(raw: unknown): DistributionQuantiles | null {
  const q = raw as Record<string, unknown> | null | undefined;
  if (!q || ["p20", "p40", "p60", "p80"].some((k) => typeof q[k] !== "number")) {
    return null;
  }
  return { p20: q.p20 as number, p40: q.p40 as number, p60: q.p60 as number, p80: q.p80 as number };
}

export async function fetchDistribution(
  field: string,
  bins: number | undefined,
  excludeZero: boolean | undefined,
): Promise<DistributionResult> {
  const body = await getJson("/screener/distribution", {
    field,
    ...(bins !== undefined ? { bins: String(bins) } : {}),
    ...excludeZeroParam(excludeZero),
  });

  const b = body as {
    field?: unknown;
    totalCount?: unknown;
    trueMin?: unknown;
    trueMax?: unknown;
    clippedMin?: unknown;
    clippedMax?: unknown;
    bins?: unknown;
    quantiles?: unknown;
  };
  // Only field/totalCount/bins are structural. The five ranges are legitimately null on an empty
  // population (totalCount 0), and demanding numbers turned that into a 502 claiming they were missing.
  if (typeof b.field !== "string" || typeof b.totalCount !== "number" || !Array.isArray(b.bins)) {
    throw new AppError("Distribution endpoint response is missing field/totalCount/bins", 502);
  }

  return {
    field: b.field,
    totalCount: b.totalCount,
    trueMin: toNumberOrNull(b.trueMin),
    trueMax: toNumberOrNull(b.trueMax),
    clippedMin: toNumberOrNull(b.clippedMin),
    clippedMax: toNumberOrNull(b.clippedMax),
    quantiles: normalizeQuantiles(b.quantiles),
    bins: b.bins.map((bin) => {
      const raw = bin as { min?: unknown; max?: unknown; count?: unknown };
      if (typeof raw.min !== "number" || typeof raw.max !== "number" || typeof raw.count !== "number") {
        throw new AppError("Distribution endpoint response has a bin missing min/max/count", 502);
      }
      return { min: raw.min, max: raw.max, count: raw.count };
    }),
  };
}

/**
 * ScreenerGatewayPort 的實作。上面的 fetchX 函式已經做完正規化與 400/502 判定，這裡只是把它們對應到
 * port 的方法名。
 *
 * getValuationRanking 指向隔壁的 valuationRanking.client.ts：那支打的是 /valuation/ranking（不在
 * /screener 底下），但對 application 來說是同一個切片的同一個問題，所以合在同一個 port 出口——哪幾個
 * 檔案湊出一個 port 是 infrastructure 的細節，不該漏到呼叫端的依賴清單上。
 *
 * 這個切片保留了 screener.service.ts：那裡有本地型錄驗證、"stock.price" 合併、估值排行改道等真正的
 * 規則，不是 `getX(a) => fetchX(a)` 的空殼。純轉發的 runCompanyRank/runDistribution 兩支則已經刪掉，
 * route 直接呼叫這個 port（跟 macro 切片同樣的判斷）。
 */
export const analysisScreenerGateway: ScreenerGatewayPort = {
  runScreener: fetchScreenerResults,
  runRanking: fetchScreenerRanking,
  getValues: fetchScreenerValues,
  getCompanyRank: fetchCompanyRank,
  getDistribution: fetchDistribution,
  getValuationRanking: fetchValuationRanking,
};
