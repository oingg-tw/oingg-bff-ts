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
  /** Null exactly when value is null (nothing to evaluate) — never re-derive this from value + threshold. */
  passed: boolean | null;
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
