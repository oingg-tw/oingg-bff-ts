export type EtfFilterFieldKind = "numeric" | "categorical";

export interface EtfFilterField {
  field: string;
  label: string;
  kind: EtfFilterFieldKind;
  /** Only present for kind: "categorical" — live DB-distinct values, not a hardcoded enum (confirmed with analysis-ts directly: assetClass's list can grow over time). */
  values?: string[];
}

export interface EtfFilterCatalog {
  fields: EtfFilterField[];
}

export interface EtfNumericFilter {
  field: string;
  min: number | null;
  max: number | null;
  /** false (default): keep rows within [min, max]. true: keep rows OUTSIDE [min, max] instead. */
  exclude: boolean;
}

/** IN semantics — keep rows whose field's value is one of `values`. Used for market/assetClass/isActive. */
export interface EtfCategoricalFilter {
  field: string;
  values: string[];
}

export type EtfScreenerFilter = EtfNumericFilter | EtfCategoricalFilter;

export interface EtfColumnRef {
  field: string;
}

/**
 * Unlike the stock screener's values (always normalized to `{ value: string|null, asOfDate }`), ETF
 * screener values are passed through with whatever type analysis-ts sends (number/string/boolean/null) —
 * this is a first version of a feature analysis-ts expects to keep expanding, so no premature
 * normalization scheme has been settled on yet.
 */
export type EtfScreenerValue = number | string | boolean | null;

export interface EtfScreenerResultRow {
  symbol: string;
  fundName: string;
  shortName: string;
  /** The issuing investment trust company (e.g. "元大投信") — not a stock-company-reference-table match; ETFs don't have that kind of row (same distinction as GET /market/etf-ranking's issuerName). */
  issuerName: string | null;
  category: string;
  values: Record<string, EtfScreenerValue>;
}

export interface EtfScreenerResult {
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  results: EtfScreenerResultRow[];
}
