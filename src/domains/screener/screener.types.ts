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
