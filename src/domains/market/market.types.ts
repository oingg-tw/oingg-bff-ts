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

/// TWSE+TPEx merged as of 2026-09-01 (tpex-ts opened a matching export dataset) — every row in these
/// 5 endpoints below now carries `market` so the frontend can tell which exchange a symbol is on.
export type Market = "TWSE" | "TPEx";

export type RevenueRankingMetric = "yoy" | "mom" | "revenue";
export type RankingOrder = "asc" | "desc";

export interface RevenueRankingEntry {
  rank: number;
  symbol: string;
  /** From oingg-analysis-ts's company reference table — null if not found there. */
  name: string | null;
  market: Market;
  currentMonthRevenue: string;
  /** null when there's no comparable prior month/year to compute a change against — not a query failure. */
  momChangePercent: string | null;
  yoyChangePercent: string | null;
}

export interface RevenueRankingResult {
  yearMonth: string;
  metric: RevenueRankingMetric;
  order: RankingOrder;
  limit: number;
  rankings: RevenueRankingEntry[];
  warnings: string[];
}

/// TPEx rows currently have null transaction/open/high/low/close/dir/change — twse-ts's TPEx export
/// dataset doesn't carry these fields yet, not a query failure (see analysis-ts's 2026-09-01 note).
export interface VolumeTop20Entry {
  rank: number;
  symbol: string;
  /** From oingg-analysis-ts's company reference table — null if not found there. */
  name: string | null;
  market: Market;
  volume: string;
  transaction: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string | null;
  dir: string | null;
  change: string | null;
}

export interface VolumeTop20Result {
  tradeDate: string | null;
  rankings: VolumeTop20Entry[];
}

/// TPEx rows currently have null announcementCount/dispositionMeasures/linkInformation — twse-ts's TPEx
/// export dataset doesn't carry these fields yet, not a query failure (see analysis-ts's 2026-09-01 note).
export interface DisposedStockEntry {
  symbol: string;
  /** From oingg-analysis-ts's company reference table — null if not found there. */
  name: string | null;
  market: Market;
  announceDate: string;
  announcementCount: number | null;
  reason: string;
  dispositionPeriod: string;
  dispositionMeasures: string | null;
  detail: string;
  linkInformation: string | null;
}

export interface DisposedStocksResult {
  limit: number;
  items: DisposedStockEntry[];
  warnings: string[];
}

export interface AttentionStockEntry {
  symbol: string;
  /** From oingg-analysis-ts's company reference table — null if not found there. */
  name: string | null;
  market: Market;
  tradeDate: string;
  criteria: string;
}

export interface AttentionStocksResult {
  limit: number;
  items: AttentionStockEntry[];
  warnings: string[];
}

/// TPEx rows currently have null openingRefPrice/previousDayPrice/allowOddLotTrade — twse-ts's TPEx
/// export dataset doesn't carry these fields yet, not a query failure (see analysis-ts's 2026-09-01 note).
export interface PriceLimitRangeEntry {
  rank: number;
  symbol: string;
  /** From oingg-analysis-ts's company reference table — null if not found there. */
  name: string | null;
  market: Market;
  limitUp: string;
  limitDown: string;
  limitRange: string;
  openingRefPrice: string | null;
  previousDayPrice: string | null;
  allowOddLotTrade: string | null;
}

export interface PriceLimitRangeResult {
  tradeDate: string | null;
  widest: PriceLimitRangeEntry[];
  narrowest: PriceLimitRangeEntry[];
}
