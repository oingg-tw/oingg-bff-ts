export interface MonthlyRevenueHistoryEntry {
  /** "YYYY-MM". */
  yearMonth: string;
  /** MOPS filing date for this month's revenue. */
  reportDate: string;
  industry: string;
  /** Bigint-serialized string (NT$ thousands, per MOPS convention) — avoids precision loss. */
  currentMonthRevenue: string;
  lastYearSameMonthRevenue: string;
  /** 年增率 — null when there's no prior-year same-month figure to compare against. */
  yoyChangePercent: number | null;
  /** 月增率 — null on the very first month in a symbol's series (no prior month to compare against). */
  momChangePercent: number | null;
  /** Year-to-date cumulative revenue, bigint-serialized string. */
  cumulativeRevenue: string;
  cumulativeLastYearRevenue: string;
  /** 累計年增率 — null when there's no prior-year cumulative figure to compare against. */
  cumulativeChangePercent: number | null;
  /** Company-provided remark for this month — analysis-ts sends "無" (literal "none") as a real string, not null, when the company explicitly reported nothing notable. Genuinely null only when no remark was filed at all. */
  note: string | null;
}

export interface MonthlyRevenueHistoryResult {
  symbol: string;
  /** Full count available (not just this page) — see metricHistoryShared.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  /** Oldest to newest, per analysis-ts's own ordering. */
  entries: MonthlyRevenueHistoryEntry[];
}
