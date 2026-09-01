export interface ForeignHoldingRankingEntry {
  symbol: string;
  sharesHeldPercent: string;
  previousSharesHeldPercent: string;
  changePercentagePoints: string;
  sharesHeld: string;
}

/**
 * `tradeDate`/`previousTradeDate` are null when analysis-ts doesn't have two trading days of
 * `foreign_holding` data to compare yet (`increases`/`decreases` are empty in that case, with a
 * warning explaining why — not a bug, see analysis-ts's note on twse-ts's backfill still being
 * in progress).
 */
export interface ForeignHoldingRankingResult {
  tradeDate: string | null;
  previousTradeDate: string | null;
  topPercent: number;
  eligibleCompanyCount: number;
  increases: ForeignHoldingRankingEntry[];
  decreases: ForeignHoldingRankingEntry[];
  warnings: string[];
}

export interface MarginShortRatioRankingEntry {
  rank: number;
  symbol: string;
  /** From oingg-analysis-ts's company reference table — null if not found there. */
  name: string | null;
  shortToMarginRatioPct: string;
  marginTodayBalance: string;
  shortTodayBalance: string;
}

export interface MarginShortRatioRankingResult {
  tradeDate: string | null;
  limit: number;
  rankings: MarginShortRatioRankingEntry[];
  warnings: string[];
}
