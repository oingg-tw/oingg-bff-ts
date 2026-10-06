/**
 * Preferred stock (特別股). Until 2026-10-07 this was TWSE-listed only; analysis-ts cc647d6f added
 * 上櫃 issues (first one: 8349A 恒耀甲特), so `marketType` is now "上市" or "上櫃".
 */
export interface PreferredStockEntry {
  symbol: string;
  name: string;
  /**
   * Null since 2026-10-07: twse-ts stopped scraping isin.twse.com.tw under the exchange's terms of use, so
   * newly listed issues (and every 上櫃 one) have no official ISIN. Show "—", never derive one — analysis-ts
   * tried a rule-based ISIN and it mismatched the exchange's own data on 1 of 28 listed preferreds.
   */
  isinCode: string | null;
  /** "YYYY-MM-DD"; null for the same reason as isinCode. 8349A's comes from its first trading day. */
  listedDate: string | null;
  /** "上市" or "上櫃" (free string upstream, not an enum). */
  marketType: string;
  /*
   * 發行條款（從 issueDate 到 redemptionConditions，以及由條款算出的殖利率類欄位）在上游契約裡本來就全部
   * 可為 null（2026-10-07 對過 analysis-ts 的 OpenAPI）：查無條款時整組一起是 null。mops 的條款表從
   * 2026-09-08 起是永久快照，之後新發行的特別股就會這樣。當時 28 檔剛好都有條款，所以 null 從沒出現過，
   * 而這裡原本用 Number()／String()／=== true 轉，會把它們變成 0、"null"、false——憑空捏造一個答案。
   * null 的意思是「條款不明」，不是 0 也不是「否」。
   */
  issueDate: string | null;
  issuePrice: number | null;
  /**
   * Fixed dividend in NT$ per share — NOT a percentage, despite the name (analysis-ts flagged this
   * explicitly as an easy field-name trap). See nominalDividendRatePct/currentYieldPct for the two
   * distinct percentage figures derived from this.
   */
  dividendRate: number | null;
  /** dividendRate / issuePrice × 100 — fixed at issuance, never changes over the security's life. */
  nominalDividendRatePct: number | null;
  /**
   * dividendRate / latest close × 100 — moves daily with price. Null when there's no price data.
   * Do not conflate with nominalDividendRatePct: e.g. 2002A 中鋼特 has a 14% nominal rate (fixed at its
   * 1974 issuance) but only ~3.75% current yield at today's price — very different numbers, both real.
   */
  currentYieldPct: number | null;
  latestClosePrice: number | null;
  latestPriceDate: string | null;

  cumulativeDividend: boolean | null;
  participatingExcessDividend: boolean | null;
  liquidationPreference: boolean | null;
  votingRights: boolean | null;
  convertible: boolean | null;
  /** Null when convertible is false. */
  conversionStartDate: string | null;
  /**
   * The issuing company's call right (公司贖回權) — the company's option to redeem the shares, NOT an
   * investor put right (投資人賣回權). Confirmed with the user directly (2026-09-06): this endpoint has
   * no field for an investor put right at all, only this company-side call right.
   */
  redeemable: boolean | null;
  /**
   * 得收回日：the EARLIEST date the issuer may call the shares, not the date they were called. Passing it
   * with the shares still outstanding is normal (e.g. 2887A), so never label it 「已贖回」. Null when
   * redeemable is false.
   */
  redemptionDate: string | null;
  /** Null when redeemable is false. */
  redemptionConditions: string | null;
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
