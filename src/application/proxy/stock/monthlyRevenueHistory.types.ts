export interface MonthlyRevenueHistoryEntry {
  /** "YYYY-MM". */
  yearMonth: string;
  /**
   * 出表日：交易所 OpenAPI 的「出表日期」，**不是**公司公告日（實測 2330 的 2026-08 月營收 9/17 出表、台積電 9/10 就公告了）——拿它當公告日會以為資料比實際早可知。
   * 2026-10-10 前叫 reportDate；10-10～10-11 誤叫 announcementDate（analysis-ts 26a59941 更正）。2021-08 以前與上櫃回填的列是 null。
   */
  generatedDate: string | null;
  /** 來源原樣的類股名稱（2026-10-10 前叫 industry）。mops 補的月份是 null。 */
  sectorName: string | null;
  /** Bigint-serialized string (NT$ thousands, per MOPS convention) — avoids precision loss. */
  currentMonthRevenue: string | null;
  lastYearSameMonthRevenue: string | null;
  /** 年增率 — null when there's no prior-year same-month figure to compare against. */
  yoyChangePct: number | null;
  /** 月增率 — null on the very first month in a symbol's series (no prior month to compare against). */
  momChangePct: number | null;
  /** Year-to-date cumulative revenue, bigint-serialized string. */
  cumulativeRevenue: string | null;
  cumulativeLastYearRevenue: string | null;
  /** 累計年增率 — null when there's no prior-year cumulative figure to compare against. */
  cumulativeChangePct: number | null;
  /** Company-provided remark for this month — analysis-ts sends "無" (literal "none") as a real string, not null, when the company explicitly reported nothing notable. Genuinely null only when no remark was filed at all. */
  note: string | null;
}

export interface MonthlyRevenueHistoryResult {
  symbol: string;
  /** Full count available (not just this page) — see historyShared.types.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  /** Oldest to newest, per analysis-ts's own ordering. */
  entries: MonthlyRevenueHistoryEntry[];
}
