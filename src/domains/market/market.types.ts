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
  /**
   * Single-day point-to-point % change, computed by analysis-ts itself from daily_price (not the
   * source's own dir/change fields, since TPEx doesn't have those natively) — guarantees the same
   * calculation for both markets. Null when there's no comparable prior trading day. Added 2026-09-02.
   */
  changePercent: string | null;
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
  /** The count parsed out of `reason` (e.g. "連續五次" -> 5, "最近10個營業日內有6個營業日" -> 6). Null when the reason has no count concept at all (e.g. convertible-bond underlying) — not a parse failure, same spirit as AttentionStockCriteriaDetail but count-only (no dates — dispositionPeriod's start~end is already simple enough). Added by analysis-ts on 2026-09-02. */
  reasonTimes: number | null;
  /**
   * A short Chinese label parsed from `reason` (e.g. a reference to 本中心作業要點第四條第一項第一款 ->
   * "漲跌異常"), matched against the official 公布或通知注意交易資訊暨處置作業要點's 13 clauses (第一款~
   * 第十三款). Null when `reason` doesn't reference a recognizable clause/keyword (a plain "連續N次" with
   * nothing else) — not guessed. Added by analysis-ts on 2026-09-02, who noted the TPEx-side clause
   * numbering is inferred (matched to TWSE's near-identical rule names + verified against real data),
   * not confirmed against TPEx's own official text (their page 403s) — may get corrected later.
   */
  reasonShort: string | null;
  dispositionPeriod: string;
  /** `dispositionPeriod` split into two Gregorian-calendar dates — `dispositionPeriod` itself is unaffected. Added by analysis-ts on 2026-09-02. */
  dispositionStartDate: string;
  dispositionEndDate: string;
  dispositionMeasures: string | null;
  detail: string;
  linkInformation: string | null;
  /**
   * Cumulative price change over the 6 trading days up to `announceDate` (point-to-point close vs. close
   * 6 trading days prior — compounded, not a sum of daily changes). Null when fewer than 6 comparable
   * trading days exist. Added by analysis-ts on 2026-09-02 as price context for why this stock was
   * disposed (exchange thresholds reference exactly this kind of 6-day cumulative move).
   */
  sixDayChangePercent: string | null;
}

export interface DisposedStocksResult {
  limit: number;
  items: DisposedStockEntry[];
  warnings: string[];
}

/**
 * One parsed clause from `criteria`'s free-text Chinese description (e.g. "115年8月28日至115年8月31日
 * 連續二次") — an array, not a single object, because the raw text sometimes concatenates two clauses
 * with no separator. `observationDays` is only populated for the "N個營業日內已有M次" phrasing; the
 * "連續N次" phrasing leaves it null. Added by analysis-ts on 2026-09-01.
 */
export interface AttentionStockCriteriaDetail {
  startDate: string;
  endDate: string;
  observationDays: number | null;
  times: number;
}

export interface AttentionStockEntry {
  symbol: string;
  /** From oingg-analysis-ts's company reference table — null if not found there. */
  name: string | null;
  market: Market;
  tradeDate: string;
  criteria: string;
  /** Empty when analysis-ts's parse of `criteria` fails (e.g. upstream text format changes) — `criteria` itself is unaffected. */
  criteriaDetails: AttentionStockCriteriaDetail[];
  /**
   * Cumulative price change over the 6 trading days up to `tradeDate` (point-to-point close vs. close 6
   * trading days prior — compounded, not a sum of daily changes). Null when fewer than 6 comparable
   * trading days exist. Added by analysis-ts on 2026-09-02 — exchange attention-stock thresholds
   * themselves reference this kind of 6-day cumulative move, so it's price context for why a stock was
   * flagged, same rationale as DisposedStockEntry's `sixDayChangePercent`.
   */
  sixDayChangePercent: string | null;
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

/**
 * TWSE and TPEx each use their own latest two trading days (not forced onto a shared date) — so
 * `tradeDate`/`previousTradeDate` live per-row here, unlike foreign-holding-ranking's single top-level
 * date pair. Computed by analysis-ts from daily_price (already a full-market mirror), not a twse-ts/
 * tpex-ts export dataset — real data from day one, no deploy wait (added 2026-09-02).
 */
export interface PriceChangeRankingEntry {
  rank: number;
  symbol: string;
  /** From oingg-analysis-ts's company reference table — null if not found there. */
  name: string | null;
  market: Market;
  tradeDate: string;
  previousTradeDate: string;
  close: string;
  previousClose: string;
  changeAmount: string;
  changePercent: string;
}

export interface PriceChangeRankingResult {
  limit: number;
  gainers: PriceChangeRankingEntry[];
  losers: PriceChangeRankingEntry[];
  warnings: string[];
}

export type EtfRankingMetric =
  | "aum"
  | "holders"
  | "netFlow"
  | "dcaAmount"
  | "return3m"
  | "return6m"
  | "return1y"
  | "return2y"
  | "return3y"
  | "return5y"
  | "returnYtd"
  | "return10y"
  | "expenseRatio";

/**
 * ETF ranking (first endpoint sourced from sitca-ts, added 2026-09-02) — aum/holders/netFlow/dcaAmount
 * are sitca-ts's latest monthly snapshot (`asOf` is "YYYY-MM"); the 8 return* metrics are cumulative
 * (not annualized) returns over that period; expenseRatio uses only the latest *complete* calendar year
 * (`asOf` is "YYYY") and excludes ETFs whose inception falls in or after that base year, so different
 * base years never mix. Includes every ETF type (leveraged/inverse included) — the opposite of the
 * stock-ranking endpoints' ETF exclusion, since this endpoint's whole purpose is ranking ETFs.
 */
export interface EtfRankingEntry {
  rank: number;
  symbol: string;
  fundName: string;
  shortName: string;
  /** The issuing investment trust company (e.g. "元大投信") — NOT a stock-company-reference-table match like other endpoints' `name`; ETFs don't have that kind of row. */
  issuerName: string | null;
  category: string;
  value: string;
  asOf: string;
}

export interface EtfRankingResult {
  metric: EtfRankingMetric;
  order: RankingOrder;
  limit: number;
  rankings: EtfRankingEntry[];
  warnings: string[];
}
