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

export interface ScreenerResultRow {
  symbol: string;
  values: Record<string, unknown>;
}

export interface ScreenerResult {
  count: number;
  columns: ScreenerResultColumn[];
  results: ScreenerResultRow[];
}
