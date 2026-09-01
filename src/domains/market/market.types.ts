export interface ForeignHoldingRankingEntry {
  symbol: string;
  /** From oingg-analysis-ts's company reference table — null if not found there. */
  name: string | null;
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
  limit: number;
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

/// 上市公司重大訊息公告 (material announcement) — one filing, from oingg-analysis-ts's GET
/// /market/material-announcements. `announcementTime` is a raw HHMMSS-style numeric string as sent by
/// twse-ts (e.g. "70003" — not zero-padded), passed through as-is rather than reformatted.
export interface MaterialAnnouncementEntry {
  symbol: string;
  /** From oingg-analysis-ts's company reference table — null if not found there. */
  name: string | null;
  announcementDate: string;
  announcementTime: string;
  reportDate: string;
  subject: string;
  clause: string;
  factDate: string;
  description: string;
}

export interface MaterialAnnouncementsResult {
  limit: number;
  items: MaterialAnnouncementEntry[];
  warnings: string[];
}
