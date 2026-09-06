export interface FilterField {
  key: string;
  name: string;
  period: string;
  /** What this specific number means (e.g. calculation basis, TTM vs quarterly) — shown as an info-icon tooltip on the frontend. Null until oingg-analysis-ts's /filters starts sending it. */
  description?: string | null;
  /** Where this number is computed from (e.g. which upstream report/table) — shown alongside description. Null until oingg-analysis-ts's /filters starts sending it. */
  source?: string | null;
  /** Display unit (e.g. "percent", "currency", "times", "ratio") — overrides the metric's own unit when
   * set (e.g. dupont.assetTurnoverQuarterly is "times" even though the dupont metric's own unit is
   * "percent"). Null/undefined means "use the metric's unit" (see FilterMetric.unit). */
  unit?: string | null;
  /** Display order among sibling fields under the same metric (0-based). The response array is already
   * in this order — exposed explicitly too so a frontend that reorders/filters the array client-side
   * doesn't need to separately preserve original position to get back to it. */
  sort: number;
}

export interface FilterMetric {
  key: string;
  name: string;
  path: string;
  /** Metric-level definition, same tooltip purpose as FilterField.description but for the metric as a whole. */
  description?: string | null;
  /** Metric-level data source, same tooltip purpose as FilterField.source but for the metric as a whole. */
  source?: string | null;
  /** Metric-level display unit — the default for every field under it, unless a field overrides it (see FilterField.unit). */
  unit?: string | null;
  /** Display order among sibling metrics under the same category (0-based) — see FilterField.sort. */
  sort: number;
  fields: FilterField[];
}

export interface FilterCategory {
  key: string;
  name: string;
  /** Display order among categories (0-based) — see FilterField.sort. */
  sort: number;
  metrics: FilterMetric[];
}
