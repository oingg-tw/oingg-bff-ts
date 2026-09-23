/**
 * Naming note (2026-09-11 ubiquitous-language audit): this file used to call every one of these types
 * "EtfFilter*", which conflated two different senses of "filter" in the same file — these three
 * (EtfFieldKind/EtfField/EtfFieldCategory/EtfFieldCatalog) are catalog/definition shapes (what fields
 * EXIST and what they mean), not screening criteria. EtfNumericFilter/EtfCategoricalFilter/
 * EtfScreenerFilter further below are the actual filters (screening/narrowing conditions) — renamed
 * the former group to "Field"/"Category"/"Catalog" so the two senses read as clearly distinct, matching
 * the stock side's already-established Metric* vs Filter* split.
 */
export type EtfFieldKind = "numeric" | "categorical";

export interface EtfField {
  field: string;
  label: string;
  kind: EtfFieldKind;
  /** Only present for kind: "numeric" — display unit (e.g. "元", "%", "人"), added 2026-09-11 alongside the categories restructure. */
  unit?: string;
  /** Only present for kind: "categorical" — live DB-distinct values, not a hardcoded enum (confirmed with analysis-ts directly: assetClass's list can grow over time). */
  values?: string[];
}

export interface EtfFieldCategory {
  categoryKey: string;
  categoryDisplayName: string;
  fields: EtfField[];
}

/**
 * Restructured 2026-09-11 from a flat `{ fields: [...] }` array to nested categories (5: identity/
 * sizeAndFlow/navAndPrice/performance/cost), matching the stock side's GET /metrics categories shape —
 * analysis-ts's own migration, not a bff-ts design choice. Passed through as-is, not flattened here;
 * a flat field list (if a consumer needs one) is the consumer's own flatMap over categories[].fields.
 */
export interface EtfFieldCatalog {
  categories: EtfFieldCategory[];
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
