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

export interface FilterMetricBadgeThreshold {
  description: string;
  denominator: number;
  /** "in_range" (2026-09-10, dividendPayoutRatio's Fidelity-range correction) pairs with valueMin/valueMax
   * instead of value — met when the metric's value falls between the two, inclusive on both ends. */
  comparator?: "gt" | "lt" | "gte" | "abs_lt" | "in_range";
  value?: number;
  /** Only set (and only meaningful) when comparator is "in_range" — the inclusive lower/upper bounds. */
  valueMin?: number;
  valueMax?: number;
  /** e.g. "stockPrice.Q" for grahamNumber/ncav — compare this metric's value against another field's. */
  compareAgainstFieldId?: string;
  /** eps's own case: ["eps.TTM", "eps.Q"] — met only when every listed field is positive. */
  allPositiveFieldIds?: string[];
}

/**
 * A curated "guru badge" methodology threshold (e.g. Graham Number, Piotroski F-Score-style methodologies)
 * — moved from web-nuxt's own hardcoded GURU_BADGES table into analysis-ts's MetricDefinitionSpec 2026-09-10,
 * echoed back here so bff-ts's consumers don't need their own copy. Present on only the ~11 metrics that
 * table covered (see FilterMetric.badge).
 */
export interface FilterMetricBadge {
  id: string;
  name: string;
  nameEn: string;
  author: string;
  summary: string;
  detail: string;
  /**
   * The basis/period this badge's threshold applies to (e.g. "TTM"/"Q"/"FY"). Absent when the threshold
   * itself spans multiple periods instead of applying to one (e.g. eps's allPositiveFieldIds threshold
   * checks both "eps.TTM" and "eps.Q" — there's no single token to name).
   */
  token?: string;
  threshold: FilterMetricBadgeThreshold;
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
  /**
   * LaTeX source for this metric's formula, meant for read-only rendering (e.g. KaTeX/mathlive
   * `<math-field readonly>`) so the frontend never re-derives or hand-copies a formula that could drift
   * from analysis-ts's own definition. Null when analysis-ts hasn't documented a formula for this metric
   * yet — as of 2026-09-10 (pilot rollout) this is true for all but 4 metrics (roe/peRatio/sue/
   * chowderNumber), and the field is entirely absent from analysis-ts's response for those, not sent as
   * an empty string. NOT meant to be evaluated for actual computation (analysis-ts's own note: their real
   * figures are bigint-precise, a LaTeX compute-engine would be float-based) — display only.
   */
  formulaLatex?: string | null;
  /**
   * URL to an external reference explaining this metric (e.g. a Wikipedia article), meant to replace
   * per-consumer hardcoded source links (e.g. web-nuxt's guru-badges.ts) with whatever analysis-ts's own
   * MetricDefinitionSpec declares. Null when analysis-ts hasn't documented a reference for this metric
   * yet — same "not every metric has one yet" convention as formulaLatex, added 2026-09-10.
   */
  referenceUrl?: string | null;
  /**
   * Curated "guru badge" methodology threshold (e.g. Graham Number, Altman Z-Score) — see
   * FilterMetricBadge. Present only on the ~11 metrics analysis-ts has one for as of 2026-09-10; null
   * everywhere else, including Piotroski F-Score (deliberately excluded, stays frontend-hardcoded — its
   * clamp/round + custom isMet logic doesn't fit analysis-ts's threshold/comparator vocabulary).
   */
  badge?: FilterMetricBadge | null;
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
