/**
 * One "guru badge" methodology evaluated against a specific company — distinct from
 * MetricDefinition.badge (see metricCatalog.types.ts), which describes the badge itself (name/threshold/
 * methodology, market-wide, not company-specific). This is the actual computed value plus whether the
 * company passed, sourced from analysis-ts's own evaluateCompanyBadges logic — added 2026-09-14
 * specifically so consumers never have to re-derive "passed" themselves by comparing a raw value against
 * MetricDefinition.badge.threshold (a real bug class analysis-ts hit: different badges' thresholds aren't
 * uniformly comparable, and null/industry-exclusion cases were mishandled). `passed` here is the single
 * source of truth for whether a badge is met — never recompute it from `value` + a threshold.
 */
export interface CompanyBadgeEntry {
  metricCode: string;
  name: string;
  nameEn: string;
  timeframe: string;
  value: number | null;
  nullReason: string | null;
  /** Added by analysis-ts 2026-09-14 — same semantics as metrics-history/piotroski-breakdown: the date this value was as-of, null alongside value when there's nothing to evaluate. */
  knowledgeDate: string | null;
  /** True when knowledgeDate is a fallback (fiscal period end date) rather than the real filing/announcement date. */
  knowledgeDateIsFallback: boolean | null;
  /** Null exactly when value is null (nothing to evaluate) — never re-derive this from value + threshold. */
  passed: boolean | null;
  /**
   * Whether this company falls in the badge's stricter "danger zone" threshold (see MetricBadgeThreshold.
   * warning in metricCatalog.types.ts) — added 2026-09-20, so far only defined for piotroskiFScore's
   * badge. Null both when value is null (nothing to evaluate, same as `passed`) AND when this badge has
   * no warning-zone threshold defined at all (confirmed live: every non-piotroskiFScore badge is
   * warning:null even with a real passed value) — don't treat null here as "false". Not the logical
   * inverse of `passed` either — a badge can be passed:false without being in the warning zone (a
   * middling score that's neither "high" nor "low" by the methodology's own definition), confirmed live
   * (2317 piotroskiFScore: passed:false, warning:false; 2454 piotroskiFScore: passed:false, warning:true).
   */
  warning: boolean | null;
}

export interface CompanyBadgeCategory {
  categoryKey: string;
  categoryDisplayName: string;
  badges: CompanyBadgeEntry[];
}

export interface CompanyBadgesResult {
  symbol: string;
  categories: CompanyBadgeCategory[];
}
