/** dupont-history has no Q_ANN option — confirmed live (2026-09-07), unlike roe-history/roa-history. */
export type DupontHistoryBasis = "Q" | "TTM";

/**
 * ROE decomposed into its 3 DuPont factors for one quarter — a genuinely different shape from
 * historyShared.types.ts's FlatHistoryEntry (multiple figures per quarter, not one `value`).
 */
export interface DupontHistoryEntry {
  fiscalYear: number;
  /** null on annual (FY) rows — they have no quarter. */
  fiscalQuarter: number | null;
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
  /**
   * 這一期用的財務報表類型：`"2"` = 合併報表、`"1"` = 個別報表（MOPS 的 dataType 編號，**跟
   * companyProfile 的 `financialReportType` 方向相反**，見那邊的說明）。2026-09-27 新增。
   *
   * **為什麼逐期而不是逐公司**：有 31 家公司賣掉或併掉子公司後只申報個別報表，analysis-ts 把兩段歷史
   * 接成一條線，所以同一條數列裡轉換點之前是合併、之後是個別。公司層級的 `metricDataType` 只說得出
   * 「現在」用哪一種，說不出哪一期是哪一種。一般公司每一期恆為 `"2"`、249 家個別申報者恆為 `"1"`。
   *
   * **選填的理由不是「可能漏送」**：日頻指標（exchangePeRatio、live* 等）走這支端點時沒有報表類型的
   * 概念，所以上游不送這個欄位（實測 2330 的 exchangePeRatio.EOD 沒有 dataType，但有 tradeDate）。
   * 所以 null 的意思是「這個指標不適用報表類型」，不是「不知道」——季頻指標（Q/TTM/FY）缺這個欄位才是
   * 版本錯開。
   */
  dataType: "1" | "2" | null;
}

export interface DupontHistoryResult {
  symbol: string;
  timeframe: DupontHistoryBasis;
  /** Full count available (not just this page) — see historyShared.types.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  /** Oldest to newest, per analysis-ts's own ordering. */
  entries: DupontHistoryEntry[];
}
