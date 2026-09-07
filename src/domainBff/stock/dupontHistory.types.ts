/** dupont-history has no Q_ANN option — confirmed live (2026-09-07), unlike roe-history/roa-history. */
export type DupontHistoryBasis = "Q" | "TTM";

/**
 * ROE decomposed into its 3 DuPont factors for one quarter — a genuinely different shape from
 * metricHistoryShared.ts's FlatHistoryEntry (multiple figures per quarter, not one `value`).
 */
export interface DupontHistoryEntry {
  fiscalYear: number;
  fiscalQuarter: number;
  /** 淨利率 (net income / revenue × 100). */
  netProfitMarginPct: number | null;
  /** 資產週轉率 (revenue / average assets). */
  assetTurnover: number | null;
  /**
   * 權益乘數 (average assets / average equity) — observed null under basis=TTM in current data
   * (2026-09-07, real 2330 entries), populated under basis=Q. Not confirmed with analysis-ts why TTM
   * omits it; don't assume every TTM entry always lacks it without re-checking.
   */
  equityMultiplier: number | null;
  /** netProfitMarginPct × assetTurnover × equityMultiplier, analysis-ts's own recomposed ROE check figure. */
  decomposedRoePct: number | null;
  /** Why one or more of the 3-factor figures above is null for this quarter — null when all are present. */
  nullReason: string | null;
  /**
   * 5-factor extended DuPont: tax burden (稅負) — net income / pre-tax income × 100. Added by analysis-ts
   * 2026-09-07, in the same dupont-history response (no new endpoint/params).
   */
  dupontTaxBurdenPct: number | null;
  /** 5-factor extended DuPont: interest burden (利息負擔) — pre-tax income / EBIT × 100. */
  dupontInterestBurdenPct: number | null;
  /** 5-factor extended DuPont: EBIT margin (EBIT 利潤率) — EBIT / revenue × 100. */
  dupontEbitMarginPct: number | null;
  /**
   * dupontTaxBurdenPct × dupontInterestBurdenPct × dupontEbitMarginPct × assetTurnover × equityMultiplier
   * — the 5-factor recomposed ROE check figure, analogous to decomposedRoePct but for the 5-factor
   * breakdown. Has its own independent null-reason field below rather than sharing `nullReason`, since
   * the 5-factor completeness check is stricter than the 3-factor one (a quarter can have all 3 basic
   * factors but be missing what the 2 extra 5-factor figures need).
   */
  dupontExtendedRoePct: number | null;
  /** Why dupontExtendedRoePct is null for this quarter — independent of `nullReason`, null when present. */
  dupontExtendedRoeNullReason: string | null;
  /** The financial-report announcement date this figure is aligned to — not a daily market-data date. */
  knowledgeDate: string;
  /** True when knowledgeDate is a fallback estimate rather than the real announcement date. */
  knowledgeDateIsFallback: boolean;
}

export interface DupontHistoryResult {
  symbol: string;
  basis: DupontHistoryBasis;
  /** Full count available (not just this page) — see metricHistoryShared.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  /** Oldest to newest, per analysis-ts's own ordering. */
  entries: DupontHistoryEntry[];
}
