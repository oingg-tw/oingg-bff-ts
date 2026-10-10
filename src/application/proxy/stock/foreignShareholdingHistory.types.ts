export interface ForeignShareholdingHistoryEntry {
  tradeDate: string;
  sharesHeldPct: number | null;
  /** Regulatory foreign-ownership cap for this symbol, as a percentage — 100 when uncapped. */
  foreignLimitPct: number | null;
  /** foreignLimitPct - sharesHeldPct — remaining room before the cap binds. */
  availableInvestPct: number | null;
}

export interface ForeignShareholdingHistoryResult {
  symbol: string;
  /**
   * Newest to oldest — the opposite order from metric-history/roe-history/roa-history/dupont-history/
   * monthly-revenue-history (all oldest-to-newest). Confirmed live with analysis-ts, 2026-09-08.
   */
  entries: ForeignShareholdingHistoryEntry[];
}
