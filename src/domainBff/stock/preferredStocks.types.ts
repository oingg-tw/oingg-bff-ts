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
  redeemable: boolean;
  /** Null when redeemable is false. */
  redemptionDate: string | null;
  /** Null when redeemable is false. */
  redemptionConditions: string | null;
}

export interface PreferredStocksResult {
  entries: PreferredStockEntry[];
}
