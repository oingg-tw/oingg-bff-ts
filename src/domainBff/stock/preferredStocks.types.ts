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
  /** Years of call protection before the issue becomes redeemable. Added by analysis-ts 2026-09-06. */
  callProtectionYears: number | null;
  /**
   * analysis-ts's own "買回風險" figure (added 2026-09-06), null when `redeemable` is false. Passed
   * through as-is, but its actual sign does NOT match analysis-ts's own stated formula
   * ("現價-發行價", i.e. latestClosePrice - issuePrice, same as this module's priceMinusIssuePrice) — real
   * examples (1101B: close 43.45 < issue 50, yet callRiskAmount is +6.55 not -6.55; 1522A: close 51 >
   * issue 50, yet callRiskAmount is -1 not +1) show it's actually issuePrice - latestClosePrice, the
   * opposite sign. Flagged with analysis-ts (2026-09-06), unresolved — do NOT treat this as
   * interchangeable with priceMinusIssuePrice until that's confirmed one way or the other.
   */
  callRiskAmount: number | null;
}

export interface PreferredStocksResult {
  entries: PreferredStockEntry[];
}
