/**
 * Re-exported, not defined here: ScreenerFilter/ScreenerColumnRef moved to `domain/screenerCriteria.ts`
 * (2026-09-23) because the saved-preset services store exactly these shapes, and a 業務中台 slice must
 * not import the BFF proxy layer to describe its own rows — see that file for the full reasoning. The
 * names stay available from here so the proxy's own client and response types don't move.
 */
export type { ScreenerColumnRef, ScreenerFilter } from "@/domain/screenerCriteria.js";

export interface ScreenerResultColumn {
  field: string;
  metricName: string;
  fieldName: string;
  /** Display unit (e.g. "percent", "currency", "times", "ratio") — from oingg-analysis-ts's /metrics catalog, null until they set it for this field/metric. */
  unit: string | null;
}

export interface ScreenerValue {
  value: unknown;
  /**
   * The day this specific number was found out by the market (report_date for quarterly metrics,
   * trade_date for daily/technical ones) — not when bff-ts queried it, and not "the day it took effect."
   * Different symbols can legitimately have different knowledgeDate for the same field (e.g. one company
   * hasn't filed this quarter's report yet). null when the underlying source has no such date (e.g.
   * stock.price before a symbol has any price history). Renamed from asOfDate 2026-09-13 to match
   * analysis-ts's own rename (see analysisScreenerClient.ts's normalizeValues) and bff-ts's other
   * endpoints (metric-history, roe-history, etc.), which already used this name.
   */
  knowledgeDate: string | null;
  /**
   * Why `value` is null — one of missing_input/zero_or_negative_denominator/not_applicable_industry/
   * insufficient_history (same convention as metric-history's nullReason). A null `value` WITH a reason
   * means "the data is there, this metric just can't be computed from it" — a fact about the company, not
   * absent data; a null value with no reason is the actual "we don't have a number" case. Consumers must
   * word these differently (web-nuxt shipped "尚無資料" for both and had to fix it, 2026-09-22). Also null when `value` is
   * present, or when the underlying source doesn't classify the reason (e.g. stock.price, or the
   * exchangePeRatio/exchangePbRatio/dividendYield valuation-ranking path — see screener.service.ts's
   * runValuationRanking, which constructs this value directly rather than getting it from analysis-ts's
   * screener endpoints).
   */
  nullReason: string | null;
  /**
   * 這個值用第幾版公式算的（analysis-ts 2026-09-26 新增）。跟 `GET /metrics` 的 `formulaVersion`
   * 比對，格子較舊代表算法改了但這一列還沒重算——值仍自洽、可顯示，但不應快取。
   *
   * 這一層上游的契約本來就是 nullable（查無此列時是 null），所以不像 metric-history 那樣需要
   * 為「缺席」另做決定。另外 `runValuationRanking` 是 bff-ts 自己組出這個結構、不經過
   * analysis-ts 的 screener 端點，那條路徑一律是 null——那不是缺漏，是「這個值不是由型錄裡的
   * 公式算出來的」，所以沒有版本號可談。
   */
  formulaVersion: number | null;
}

export interface ScreenerResultRow {
  symbol: string;
  /** From oingg-analysis-ts's company reference table (TWSE-listed only) — null if not found there. */
  name: string | null;
  values: Record<string, ScreenerValue>;
}

export interface ScreenerResult {
  /** Total number of matching companies across every page, not just this page's results.length. */
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  columns: ScreenerResultColumn[];
  results: ScreenerResultRow[];
}

/**
 * Response shape for POST /screener/values — no page/pageSize/totalPages, since this isn't a filtered/
 * paginated query: the caller already knows exactly which symbols it wants (typically the current page
 * of an already-loaded screener result), so there's nothing to paginate. `count` is always
 * `results.length` (== the number of symbols requested — every requested symbol gets a row, even if
 * analysis-ts has no data for it), included so callers with generic pagination-aware UI can read it the
 * same way as ScreenerResult without special-casing this endpoint.
 */
export interface ScreenerValuesResult {
  count: number;
  columns: ScreenerResultColumn[];
  results: ScreenerResultRow[];
}

/**
 * One company's rank/percentile against the whole market for a single field — GET /screener/company-rank,
 * added 2026-09-16. Complements GET /screener/ranking's "who's in the top N" with the reverse question
 * ("where does this company rank"). `rank` is 1-based, RANK()-style (ties share a rank). `totalCount` only
 * counts companies with a non-null value for this field. `topPercent` = rank÷totalCount×100 rounded to 1
 * decimal — a SMALLER topPercent means a BETTER rank (5 means "top 5% of the market"), the opposite
 * direction from an ordinary percentile — don't conflate the two. `found: false` (no data for this
 * field/symbol, or the symbol doesn't exist) still returns 200 with value/rank/totalCount/topPercent all
 * null, not a 404.
 */
export interface CompanyRankResult {
  symbol: string;
  field: string;
  found: boolean;
  value: number | null;
  rank: number | null;
  totalCount: number | null;
  topPercent: number | null;
  /**
   * Which fifth of the population this company sits in, 1–5, straight from analysis-ts — added here
   * 2026-09-24 after it turned out they had been sending it for a while and the field-by-field
   * normalizer was silently dropping it (the documented hazard of that pattern).
   *
   * Direction follows `direction`: with `desc`, 5 is the best fifth. Note this is NOT derivable from
   * `topPercent` by the caller, because ties share a rank (RANK() semantics) — analysis-ts cuts the
   * quintile on the real distribution, not on rank÷totalCount. Null whenever `found` is false.
   */
  quintile: number | null;
}

/** One bucket of a DistributionResult's `bins` array — see DistributionResult. */
export interface DistributionBin {
  min: number;
  max: number;
  count: number;
}

/**
 * The whole market's distribution for a single field — GET /screener/distribution, added 2026-09-18 for a
 * market-wide histogram (e.g. 現金殖利率的市場排名 on a stock-detail card). `trueMin`/`trueMax` are the
 * actual min/max across every company with a non-null value for this field; `clippedMin`/`clippedMax` are
 * the range the `bins` actually cover (analysis-ts may clip outliers before bucketing — see their own
 * endpoint for the exact rule). `totalCount` only counts companies with a non-null value for this field,
 * same convention as CompanyRankResult.
 *
 * Every numeric field is nullable because an empty population is a legitimate answer, not an error:
 * analysis-ts returns totalCount 0 with all five ranges null (e.g. a monthly metric before its first
 * month lands). bff-ts used to require them to be numbers and turned that into a 502 saying the response
 * was "missing" them, which was both a false alarm and a misleading message — fixed 2026-09-24.
 */
export interface DistributionResult {
  field: string;
  totalCount: number;
  trueMin: number | null;
  trueMax: number | null;
  clippedMin: number | null;
  clippedMax: number | null;
  bins: DistributionBin[];
  /**
   * The values at the quintile boundaries — what a company's value has to reach to sit on the 20/40/60/80
   * line. Added by analysis-ts 2026-09-24 so a histogram axis can be labelled by position in the
   * population instead of by evenly-spaced numbers, which say nothing about where a reader sits.
   *
   * Computed in the same `percentile_cont` query and under the same filter as `bins`/`totalCount`, so the
   * population cannot drift between them. Null when totalCount is 0.
   *
   * Do not derive these from `bins`: interpolating inside a bucket is guesswork on a right-skewed field
   * like dividend yield, where the low buckets hold most of the market. This is the complement of
   * CompanyRankResult.quintile — that says which fifth a company is in, this says where the lines are.
   */
  quantiles: DistributionQuantiles | null;
}

/** Quintile boundary values, in the same unit as the field itself. */
export interface DistributionQuantiles {
  p20: number;
  p40: number;
  p60: number;
  p80: number;
}

/**
 * Which field to sort the full result set by, and in which direction. analysis-ts requires both halves or
 * neither (see screenerFilterInput.ts's parseSort), which is why this is one object rather than two
 * independent optional params. Sorting happens upstream across every match, not just the returned page.
 *
 * Declared here rather than in analysisScreenerClient.ts (where it used to live): it's part of what a
 * caller hands ScreenerGatewayPort, so the request parsers, runPreset and the route can't be made to
 * import the infrastructure module just to name it.
 */
export interface ScreenerSort {
  field: string;
  order: "asc" | "desc";
}

/**
 * The raw per-symbol row ScreenerGatewayPort returns — the same symbol/name/values triple as
 * ScreenerResultRow, kept as its own name because it is what comes *back from the gateway*, before
 * screener.service.ts merges "stock.price" in and attaches the display columns.
 */
export interface ScreenerGatewayRow {
  symbol: string;
  /** Attached directly by the gateway as of 2026-09-01 — null when it has no name on file for the symbol. */
  name: string | null;
  values: Record<string, ScreenerValue>;
}

/** Filtered + paginated screener results, before bff-ts attaches display columns. */
export interface ScreenerGatewayResult {
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  results: ScreenerGatewayRow[];
}

/** Top-N ranking rows — no pagination metadata, by design (see runRanking). */
export interface ScreenerRankingGatewayResult {
  results: ScreenerGatewayRow[];
}

/** Values for an explicit symbol list — no pagination, and rows may be missing (see runScreenerValues). */
export interface ScreenerValuesGatewayResult {
  results: ScreenerGatewayRow[];
}

/**
 * The three fields with a dedicated upstream ranking endpoint — see screener.service.ts's
 * VALUATION_RANKING_FIELDS for how a catalog field maps onto one of these.
 */
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
