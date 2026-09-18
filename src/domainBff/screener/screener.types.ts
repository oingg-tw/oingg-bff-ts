export interface ScreenerFilter {
  /** "<metricKey>.<fieldKey>", e.g. "margins.grossMarginTtm" */
  field: string;
  min: number | null;
  max: number | null;
  /** false (default): keep rows within [min, max]. true: keep rows OUTSIDE [min, max] instead. */
  exclude: boolean;
}

export interface ScreenerColumnRef {
  field: string;
}

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
   * insufficient_history (same convention as metric-history's nullReason), or null when `value` is
   * present, or when the underlying source doesn't classify the reason (e.g. stock.price, or the
   * exchangePeRatio/exchangePbRatio/dividendYield valuation-ranking path — see screener.service.ts's
   * runValuationRanking, which constructs this value directly rather than getting it from analysis-ts's
   * screener endpoints).
   */
  nullReason: string | null;
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
 */
export interface DistributionResult {
  field: string;
  totalCount: number;
  trueMin: number;
  trueMax: number;
  clippedMin: number;
  clippedMax: number;
  bins: DistributionBin[];
}
