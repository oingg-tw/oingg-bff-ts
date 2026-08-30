export interface FilterField {
  key: string;
  name: string;
  period: string;
  /** What this specific number means (e.g. calculation basis, TTM vs quarterly) — shown as an info-icon tooltip on the frontend. Null until oingg-analysis-ts's /filters starts sending it. */
  description?: string | null;
  /** Where this number is computed from (e.g. which upstream report/table) — shown alongside description. Null until oingg-analysis-ts's /filters starts sending it. */
  source?: string | null;
}

export interface FilterMetric {
  key: string;
  name: string;
  path: string;
  /** Metric-level definition, same tooltip purpose as FilterField.description but for the metric as a whole. */
  description?: string | null;
  /** Metric-level data source, same tooltip purpose as FilterField.source but for the metric as a whole. */
  source?: string | null;
  fields: FilterField[];
}

export interface FilterCategory {
  key: string;
  name: string;
  metrics: FilterMetric[];
}
