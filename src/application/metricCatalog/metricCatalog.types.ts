export interface MetricField {
  key: string;
  name: string;
  period: string;
  /** What this specific number means (e.g. calculation basis, TTM vs quarterly) — shown as an info-icon tooltip on the frontend. Null until oingg-analysis-ts's /metrics starts sending it. */
  description?: string | null;
  /** Where this number is computed from (e.g. which upstream report/table) — shown alongside description. Null until oingg-analysis-ts's /metrics starts sending it. */
  source?: string | null;
  /** Display unit (e.g. "percent", "currency", "times", "ratio") — overrides the metric's own unit when
   * set (e.g. dupont.assetTurnoverQuarterly is "times" even though the dupont metric's own unit is
   * "percent"). Null/undefined means "use the metric's unit" (see MetricDefinition.unit). */
  unit?: string | null;
  /** Display order among sibling fields under the same metric (0-based). The response array is already
   * in this order — exposed explicitly too so a frontend that reorders/filters the array client-side
   * doesn't need to separately preserve original position to get back to it. */
  sort: number;
}

export interface MetricBadgeThreshold {
  description: string;
  /**
   * Required on a badge's top-level threshold. On a nested `warning` threshold (see below), analysis-ts
   * omits it entirely rather than repeating the parent's value (confirmed live, 2026-09-20:
   * piotroskiFScore.badge.threshold.warning has no denominator field at all, not even the same 9) — same
   * denominator as the threshold it's nested in, not a separate one.
   */
  denominator?: number;
  /** "in_range" (2026-09-10, dividendPayoutRatio's Fidelity-range correction) pairs with valueMin/valueMax
   * instead of value — met when the metric's value falls between the two, inclusive on both ends. "lte"
   * (2026-09-20, first seen on piotroskiFScore's nested `warning` threshold) is the inclusive counterpart
   * to the pre-existing "lt" — "gte" already existed as gt's inclusive counterpart, "lte" had just never
   * been used until this threshold needed a ≤ comparison. */
  comparator?: "gt" | "lt" | "gte" | "lte" | "abs_lt" | "in_range";
  value?: number;
  /** Only set (and only meaningful) when comparator is "in_range" — the inclusive lower/upper bounds. */
  valueMin?: number;
  valueMax?: number;
  /** e.g. "stockPrice.Q" for grahamNumber/ncav — compare this metric's value against another field's. */
  compareAgainstFieldId?: string;
  /** eps's own case: ["eps.TTM", "eps.Q"] — met only when every listed field is positive. */
  allPositiveFieldIds?: string[];
  /** LaTeX source for the threshold condition itself (e.g. "\mathrm{SUE} > 2") — added by analysis-ts 2026-09-13, display-only like MetricDefinition.formulaLatex. */
  thresholdLatex?: string;
  /** Free-text annotation about where/why this specific threshold value was chosen — added 2026-09-13. */
  note?: string;
  /**
   * A secondary "danger zone" threshold, stricter than the main pass/fail line — added 2026-09-20, so far
   * only present on piotroskiFScore (main threshold ≥8 "high score"; warning ≤2 "low score", per Piotroski
   * 2000's own definition) — a genuinely separate line, not a restatement of the main one. Absent on every
   * other badge. Typed as the full MetricBadgeThreshold for reuse, but analysis-ts confirmed (2026-09-20)
   * its real shape is narrower than a top-level threshold: only description/thresholdLatex/note?/
   * comparator ('gt'|'lt'|'gte'|'lte' only, never abs_lt/in_range)/value — no denominator, valueMin/
   * valueMax, compareAgainstFieldId, or allPositiveFieldIds. Every field beyond description is already
   * optional here, so this narrower shape validates fine without a separate type — don't add fields to a
   * warning object that aren't in that confirmed list even if the top-level threshold type allows them.
   */
  warning?: MetricBadgeThreshold;
  /**
   * A cross-sectional ranking threshold ("top 20% of the market/sector") — added 2026-09-21, alternative
   * to the fixed-value comparator/value(Min/Max)/compareAgainstFieldId/allPositiveFieldIds fields above
   * (analysis-ts's convention: mutually exclusive with those, a threshold has either a fixed-value shape
   * or this one, never both — not enforced here, just passed through as-is either way). First metric:
   * novyMarxGpToAssets (scope: market, topPercent 20).
   */
  percentileRank?: MetricBadgePercentileRank;
}

export interface MetricBadgePercentileRank {
  scope: "market" | "sector";
  direction: "asc" | "desc";
  topPercent: number;
  /** Whether zero-value rows are excluded from the ranking population before computing the percentile — optional, absent means not excluded. */
  excludeZero?: boolean;
}

/**
 * A curated "guru badge" methodology threshold (e.g. Graham Number, Piotroski F-Score-style methodologies)
 * — moved from web-nuxt's own hardcoded GURU_BADGES table into analysis-ts's MetricDefinitionSpec 2026-09-10,
 * echoed back here so bff-ts's consumers don't need their own copy. Present on only the ~11 metrics that
 * table covered (see MetricDefinition.badge).
 */
export interface MetricBadge {
  /** analysis-ts dropped this field 2026-09-13 (badges are already 1:1 with the metric they're attached to, so a separate id was redundant) — kept optional here rather than removed outright, in case it comes back. */
  id?: string;
  name: string;
  nameEn: string;
  author: string;
  summary: string;
  detail: string;
  /**
   * The basis/period this badge's threshold applies to (e.g. "TTM"/"Q"/"FY") — renamed from `token` to
   * `timeframe` by analysis-ts 2026-09-14 (part of the same token->timeframe rename as the metric-history
   * query params). Absent when the threshold itself spans multiple periods instead of applying to one
   * (e.g. eps's allPositiveFieldIds threshold checks both "eps.TTM" and "eps.Q" — there's no single
   * timeframe to name). This object is echoed through to bff-ts's own GET /metrics response unchanged
   * (see metricCatalog.client.ts/repository.ts), so this rename is a real public-contract change, not
   * just an internal wire-format detail.
   */
  timeframe?: string;
  threshold: MetricBadgeThreshold;
  /**
   * A public page where the threshold/formula can actually be verified — added by analysis-ts 2026-09-20
   * (commit 2fc57f6b) after a user report that clicking a badge showed no formula/threshold (the badge had
   * no source link of its own; the frontend was substituting the metric's own `referenceUrl` as a
   * stand-in). 21 of 23 badge-bearing metrics have it as of launch (each URL manually opened and verified
   * to actually show the content); grossMargin/netProfitMargin are deliberately left without one — their
   * threshold comes from a physical book with no legitimate free full-text source. Absent (not empty
   * string) when not yet documented, same convention as MetricDefinition.referenceUrl/formulaLatex.
   */
  sourceUrl?: string;
}

export interface MetricDefinition {
  key: string;
  name: string;
  path: string;
  /** Metric-level definition, same tooltip purpose as MetricField.description but for the metric as a whole. */
  description?: string | null;
  /**
   * What this metric can't tell you (e.g. sample-size caveats, survivorship bias) — added by analysis-ts
   * 2026-09-19, alongside description/misreadings. Present on the ~35 metrics that have a badge (see
   * `badge` below) as of launch; undefined on the rest until analysis-ts documents more.
   */
  limitations?: string | null;
  /**
   * Common ways this metric gets misread/misapplied (e.g. "a high score doesn't mean the stock will go
   * up") — added by analysis-ts 2026-09-19, same badge-metrics-first coverage as limitations.
   */
  misreadings?: string | null;
  /** Metric-level data source, same tooltip purpose as MetricField.source but for the metric as a whole. */
  source?: string | null;
  /** Metric-level display unit — the default for every field under it, unless a field overrides it (see MetricField.unit). */
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
   * URL to the original academic paper (author/year/journal) behind this metric's methodology — distinct
   * from `referenceUrl` above, which is a general-reader explanation (often Wikipedia). analysis-ts's own
   * words: "referenceUrl 給一般讀者看的白話解釋，academicSourceUrl 給想找原始論文的人". Null when analysis-ts
   * hasn't documented one for this metric yet — present on only ~13 curated "guru badge" methodologies
   * (sue, the Basel III/IMF FSI banking ratios, etc.) as of 2026-09-10, same sparse-coverage pattern
   * referenceUrl started with.
   */
  academicSourceUrl?: string | null;
  /**
   * Curated "guru badge" methodology threshold (e.g. Graham Number, Altman Z-Score) — see
   * MetricBadge. Present only on the ~11 metrics analysis-ts has one for as of 2026-09-10; null
   * everywhere else, including Piotroski F-Score (deliberately excluded, stays frontend-hardcoded — its
   * clamp/round + custom isMet logic doesn't fit analysis-ts's threshold/comparator vocabulary).
   */
  badge?: MetricBadge | null;
  /**
   * Data-provenance category labels (e.g. "公開發行公司資產負債表（XBRL）"), a fixed 9-label vocabulary on
   * analysis-ts's side — distinct from the free-text `source` tooltip field above (which analysis-ts has
   * never populated). Unlike formulaLatex/referenceUrl/badge, analysis-ts guarantees this is always
   * present and non-empty for every metric (added 2026-09-10) — required here too, not a "not every
   * metric has one yet" field.
   */
  sources: string[];
  /**
   * Whether this metricCode supports GET /stocks/:symbol/metric-provenance (the raw-filing audit trail
   * behind a computed value) — added by analysis-ts 2026-09-13, a growing allowlist read off this field
   * rather than hardcoded, since coverage is expected to expand over time.
   */
  hasProvenance: boolean;
  /**
   * The metric's current formula version — the same integer analysis-ts stamps on the metric_values rows
   * it computes, so a consumer can tell when the numbers behind a metric changed meaning (e.g. sue → 3
   * after dropping its drift term; roe/roa/assetTurnover/equityMultiplier/dupont-family/sgr/netDebtToEbitda → 2
   * with the period-average denominator; everything else 1 as of 2026-09-22). Added by analysis-ts
   * 2026-09-22 (5785a6d2) as web-nuxt's "re-read the metric copy" signal. Present on every metric.
   */
  formulaVersion: number;
  /** Display order among sibling metrics under the same category (0-based) — see MetricField.sort. */
  sort: number;
  fields: MetricField[];
}

export interface MetricCategory {
  key: string;
  name: string;
  /** Display order among categories (0-based) — see MetricField.sort. */
  sort: number;
  metrics: MetricDefinition[];
}

/**
 * One field addressed by its natural key — the (metricKey, fieldKey) pair a "metricCode.token" field
 * reference parses into (see shared/fieldRef.ts). Callers routinely pass objects carrying extra
 * properties of their own (e.g. the original unparsed `field` string, so they can report which one was
 * unknown); only these two are read.
 */
export interface MetricFieldRef {
  metricKey: string;
  fieldKey: string;
}

/**
 * A catalog field resolved for display — what the screener slices need to turn a bare
 * "metricCode.token" into something a human can read in a result column header.
 */
export interface MetricFieldLookup {
  categoryKey: string;
  metricKey: string;
  metricName: string;
  fieldKey: string;
  fieldName: string;
  period: string;
  /** Field's own unit if set, else falls back to the metric's — see MetricField.unit/MetricDefinition.unit. */
  unit: string | null;
}
