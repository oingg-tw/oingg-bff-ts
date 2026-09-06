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
  /** Display unit (e.g. "percent", "currency", "times", "ratio") — from oingg-analysis-ts's /filters catalog, null until they set it for this field/metric. */
  unit: string | null;
}

export interface ScreenerValue {
  value: unknown;
  /**
   * The period/trading day this specific number describes (report_date for quarterly metrics,
   * trade_date for daily/technical ones) — not when bff-ts queried it. Different symbols can
   * legitimately have different asOfDate for the same field (e.g. one company hasn't filed this
   * quarter's report yet). null when the underlying source has no such date (e.g. stock.price
   * before a symbol has any price history).
   */
  asOfDate: string | null;
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
