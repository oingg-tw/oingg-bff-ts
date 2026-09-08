export interface ForeignShareholdingHistoryEntry {
  tradeDate: string;
  sharesHeldPercent: number;
  /** Regulatory foreign-ownership cap for this symbol, as a percentage — 100 when uncapped. */
  foreignLimitPercent: number;
  /** foreignLimitPercent - sharesHeldPercent — remaining room before the cap binds. */
  availableInvestPercent: number;
}

export interface ForeignShareholdingHistoryResult {
  symbol: string;
  /**
   * Newest to oldest — the opposite order from metric-history/roe-history/roa-history/dupont-history/
   * monthly-revenue-history (all oldest-to-newest). Confirmed live with analysis-ts, 2026-09-08.
   */
  entries: ForeignShareholdingHistoryEntry[];
}
