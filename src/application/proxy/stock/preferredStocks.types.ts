/**
 * TWSE-listed preferred stock (特別股) — TPEx has no matching registration data source, so this never
 * includes 上櫃 issues. Confirmed with analysis-ts directly (2026-09-06, real data for all fields).
 */
export interface PreferredStockEntry {
  symbol: string;
  name: string;
  isinCode: string;
  listedDate: string;
  /** Always "上市" — TWSE only. */
  marketType: string;
  issueDate: string;
  issuePrice: number;
  /**
   * Fixed dividend in NT$ per share — NOT a percentage, despite the name (analysis-ts flagged this
   * explicitly as an easy field-name trap). See nominalDividendRatePct/currentYieldPct for the two
   * distinct percentage figures derived from this.
   */
  dividendRate: number;
  /** dividendRate / issuePrice × 100 — fixed at issuance, never changes over the security's life. */
  nominalDividendRatePct: number;
  /**
   * dividendRate / latest close × 100 — moves daily with price. Null when there's no price data.
   * Do not conflate with nominalDividendRatePct: e.g. 2002A 中鋼特 has a 14% nominal rate (fixed at its
   * 1974 issuance) but only ~3.75% current yield at today's price — very different numbers, both real.
   */
  currentYieldPct: number | null;
  latestClosePrice: number | null;
  latestPriceDate: string | null;

  cumulativeDividend: boolean;
  participatingExcessDividend: boolean;
  liquidationPreference: boolean;
  votingRights: boolean;
  convertible: boolean;
  /** Null when convertible is false. */
  conversionStartDate: string | null;
  /**
   * The issuing company's call right (公司贖回權) — the company's option to redeem the shares, NOT an
   * investor put right (投資人賣回權). Confirmed with the user directly (2026-09-06): this endpoint has
   * no field for an investor put right at all, only this company-side call right.
   */
  redeemable: boolean;
  /** Null when redeemable is false. */
  redemptionDate: string | null;
  /** Null when redeemable is false. */
  redemptionConditions: string | null;
  /**
   * analysis-ts's own "買回風險" figure, null when `redeemable` is false. Confirmed formula (2026-09-06,
   * after an initial wrong description was caught by comparing live numbers and corrected by
   * analysis-ts): issuePrice - latestClosePrice. Negative means the current price already exceeds the
   * issue price, so a call at/near issue price would force investors to realize that loss (the "risk"
   * this field names); positive means no such risk.
   */
  callRiskAmount: number | null;
  /**
   * 最差殖利率 (Yield to Worst) — added by analysis-ts 2026-09-07. Populated whenever there's price data,
   * even when `redeemable` is false (equals `currentYieldPct` in that case, since nothing worse than
   * holding to maturity can happen without a call option). Null only when there's no price data at all.
   */
  ytwPct: number | null;
  /** 贖回殖利率 (Yield to Call) — null when `redeemable` is false. Added by analysis-ts 2026-09-07. */
  ytcPct: number | null;
  /**
   * Which redemption-date assumption `ytcPct` used: `scheduled_redemption_date` (the security's actual
   * `redemptionDate` hasn't passed yet), `past_redemption_date_assumed_next_period` (the real
   * redemption date is already in the past — the company hasn't exercised its call option yet — so
   * analysis-ts assumed the next period), or `no_scheduled_redemption_date_assumed_next_period` (the
   * terms have no scheduled redemption date at all, also assumed next period). Null when `redeemable`
   * is false. Added by analysis-ts 2026-09-07; third value confirmed live via GET
   * /stocks/preferred-stocks/field-catalog 2026-09-08 (real data, e.g. 1312A) — a prior version of this
   * client only recognized the first two values and silently coerced this one to null.
   */
  ytcAssumption:
    | "scheduled_redemption_date"
    | "past_redemption_date_assumed_next_period"
    | "no_scheduled_redemption_date_assumed_next_period"
    | null;
  /**
   * 溢價率 — (latestClosePrice - issuePrice) / issuePrice × 100, rounded to 2 decimals. Null unless
   * `redeemable` is true AND both `issuePrice`/`latestClosePrice` are non-null (not 0 in the
   * not-applicable case). analysis-ts's own field, added 2026-09-08 replacing the old
   * `negativeConvexityWarning` boolean (which was `溢價率 > 2%`) — now gives the raw percentage instead
   * of a fixed threshold, letting the caller pick its own cutoff. Confirmed with analysis-ts directly
   * that `negativeConvexityWarning` was removed outright, not kept alongside this.
   */
  premiumRatePct: number | null;
}

export interface PreferredStocksResult {
  entries: PreferredStockEntry[];
}
