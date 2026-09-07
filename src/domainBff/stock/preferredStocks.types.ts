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
  /**
   * latestClosePrice - issuePrice, rounded to 2 decimals — not from analysis-ts, computed here at
   * web-nuxt's deliberate request (2026-09-06) to keep this kind of derived arithmetic centralized on
   * the backend rather than duplicated across frontend call sites. Null whenever latestClosePrice is
   * null (no price data). This is the "vs. issue price" complement to a "vs. call price" premium figure
   * web-nuxt also wants, which isn't computable yet since callPrice isn't available from analysis-ts.
   */
  priceMinusIssuePrice: number | null;

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
   * analysis-ts): issuePrice - latestClosePrice — i.e. `callRiskAmount === -priceMinusIssuePrice`
   * exactly, same magnitude, opposite sign. Negative means the current price already exceeds the issue
   * price, so a call at/near issue price would force investors to realize that loss (the "risk" this
   * field names); positive means no such risk. Deliberately kept alongside priceMinusIssuePrice rather
   * than replacing it — different null-gating (this is null when not redeemable; priceMinusIssuePrice
   * is always populated whenever there's price data) and web-nuxt hasn't decided which sign convention
   * reads better for their card yet.
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
   * Which redemption date `ytcPct` assumed — `scheduled_redemption_date` (the security's actual
   * `redemptionDate` hasn't passed yet) or `past_redemption_date_assumed_next_period` (the real
   * redemption date is already in the past — the company simply hasn't exercised its call option yet —
   * so analysis-ts assumed the next period instead of leaving this unanswerable). Null when `redeemable`
   * is false. Added by analysis-ts 2026-09-07.
   */
  ytcAssumption: "scheduled_redemption_date" | "past_redemption_date_assumed_next_period" | null;
  /**
   * True when a price rise would shrink potential upside faster than a price fall grows potential
   * downside (the security's price is capped near its call price) — a genuinely three-valued field:
   * null (not `false`) when `redeemable` is false, since the concept doesn't apply at all without a call
   * option. Added by analysis-ts 2026-09-07 — do not coerce null to false, they mean different things.
   */
  negativeConvexityWarning: boolean | null;
}

export interface PreferredStocksResult {
  entries: PreferredStockEntry[];
}
