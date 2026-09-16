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
  /**
   * This symbol's earliest trade date on file in the whole database — NOT affected by this call's own
   * `limit` (added by analysis-ts 2026-09-16). Meant for web-nuxt's "大盤連動程度" comparison chart's
   * 1/2/3/5/8-year range picker: compare this date against today to know exactly how much real history a
   * symbol has (e.g. a recent IPO), instead of estimating "~250 trading days per year". Null when the
   * symbol has no price history at all.
   */
  earliestAvailableTradeDate: string | null;
}
