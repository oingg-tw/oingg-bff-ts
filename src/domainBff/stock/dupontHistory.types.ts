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
  /** Why one or more figures above is null for this quarter — null when all figures are present. */
  nullReason: string | null;
  /** The financial-report announcement date this figure is aligned to — not a daily market-data date. */
  knowledgeDate: string;
  /** True when knowledgeDate is a fallback estimate rather than the real announcement date. */
  knowledgeDateIsFallback: boolean;
}

export interface DupontHistoryResult {
  symbol: string;
  basis: DupontHistoryBasis;
  /** Oldest to newest, per analysis-ts's own ordering. */
  entries: DupontHistoryEntry[];
}
