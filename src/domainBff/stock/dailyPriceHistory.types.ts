export interface DailyPriceHistoryEntry {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DailyPriceHistoryResult {
  symbol: string;
  /** Oldest to newest (confirmed live, 2026-09-10) — same ordering as metric-history/roe-history/etc. */
  entries: DailyPriceHistoryEntry[];
}
