/**
 * One CBC (中央銀行) policy-rate adjustment — an event-series row (one per rate change), NOT a daily series.
 * All three rates are percentages as plain numbers (2 = 2%), passed through as the JSON numbers
 * analysis-ts sends (not string-normalized like the market domain's Decimal-backed price fields — these
 * are the upstream contract as given, see feedback_proxy_apis_no_transformation). `changeBp` is the
 * discount-rate delta vs. the previous adjustment in basis points (12.5 = 半碼) — null only on the very
 * first row of the full history (1989-04-01, nothing earlier to compare against); with a `from` window
 * the first returned row still has a real value, since its predecessor exists upstream.
 */
export interface CbcPolicyRateEntry {
  effectiveDate: string;
  discountRate: number;
  collateralAccommodationRate: number;
  unsecuredAccommodationRate: number;
  changeBp: number | null;
}

/** Oldest to newest — 77 events from 1989-04-01 as of 2026-09-21 when unfiltered. */
export interface CbcPolicyRateResult {
  entries: CbcPolicyRateEntry[];
}

// --- 總經特區 series (analysis-ts commit 50aeae18, 2026-09-22) ---
//
// Shared conventions across the six series below, confirmed live: every result is `{ entries }` oldest to
// newest (cpi/gdp add a top-level `category` echoing the resolved filter); monthly series carry
// `period` "YYYY-MM" + `year` + `month`, quarterly ones `period` "YYYY-Qn" + `year` + `quarter`, and the
// FX series `tradeDate` "YYYY-MM-DD"; every numeric field is `number | null` (JSON numbers, passed through
// as-is per feedback_proxy_apis_no_transformation). `from` filters are inclusive lower bounds on `period`;
// omitting them returns the full history (business-cycle 535 rows from 1982-01, gdp 182 from 1981-Q1).

/** One month of 國發會 景氣指標 (leading/coincident/lagging composite + detrended) and the 景氣對策信號. */
export interface BusinessCycleIndicatorEntry {
  period: string;
  year: number;
  month: number;
  leadingIndexComposite: number | null;
  leadingIndexDetrended: number | null;
  coincidentIndexComposite: number | null;
  coincidentIndexDetrended: number | null;
  laggingIndexComposite: number | null;
  laggingIndexDetrended: number | null;
  /** 景氣對策信號綜合分數 (9-45). */
  signalScore: number | null;
  /** 燈號, Chinese label ("紅"/"黃紅"/"綠"/"黃藍"/"藍") — passed through as the string analysis-ts sends. */
  signalLight: string | null;
}

export interface BusinessCycleIndicatorResult {
  entries: BusinessCycleIndicatorEntry[];
}

/** One month of 央行 貨幣總計數 — M1A/M1B/M2 levels (NT$ million) and their YoY %. */
export interface MonetaryAggregateEntry {
  period: string;
  year: number;
  month: number;
  m1aAmount: number | null;
  m1aYoyPercent: number | null;
  m1bAmount: number | null;
  m1bYoyPercent: number | null;
  m2Amount: number | null;
  m2YoyPercent: number | null;
}

export interface MonetaryAggregateResult {
  entries: MonetaryAggregateEntry[];
}

/**
 * Latest 10-year 公債殖利率 snapshot — the pre-existing GET /macro/gov-bond-yield-10y (point-in-time,
 * one value), distinct from the `-history` series below. `fieldStatuses` is passed through as an opaque
 * string map (empty when every field resolved normally; analysis-ts uses it to flag per-field caveats)
 * and `warnings` as strings, same convention as the market domain's ranking results.
 */
export interface GovBondYield10yResult {
  yieldPct: number | null;
  /** "YYYY-MM" the value is as of. */
  asOfMonth: string | null;
  fieldStatuses: Record<string, string>;
  warnings: string[];
}

/** One month of the 10-year 公債殖利率 (percent) — the full series counterpart of GovBondYield10yResult. */
export interface GovBondYield10yHistoryEntry {
  period: string;
  year: number;
  month: number;
  yieldPct: number | null;
}

export interface GovBondYield10yHistoryResult {
  entries: GovBondYield10yHistoryEntry[];
}

/** Same sampling semantics as market.types.ts's TaiexDailyPriceInterval — last trading day of each period, `tradeDate` stays the real date. */
export type UsdTwdRateInterval = "daily" | "weekly" | "monthly";

/** One trading day's USD/TWD (銀行買入／賣出 and 銀行間收盤). */
export interface UsdTwdRateEntry {
  tradeDate: string;
  bankBuyingRate: number | null;
  bankSellingRate: number | null;
  interbankClosingRate: number | null;
}

export interface UsdTwdRateResult {
  entries: UsdTwdRateEntry[];
}

export type CpiCategory =
  | "total"
  | "food"
  | "clothing"
  | "housing"
  | "transport_communication"
  | "medical"
  | "education_recreation"
  | "misc";

/** One month of 主計總處 CPI for one basket category — index level and YoY %. */
export interface CpiEntry {
  period: string;
  year: number;
  month: number;
  indexValue: number | null;
  yoyChangePercent: number | null;
}

export interface CpiResult {
  /** The category actually applied (defaults to "total" upstream when omitted). */
  category: CpiCategory;
  entries: CpiEntry[];
}

export type GdpCategory =
  | "growth_rate"
  | "domestic_demand_total"
  | "private_consumption"
  | "government_consumption"
  | "fixed_capital_formation_total"
  | "fixed_capital_formation_private"
  | "fixed_capital_formation_government"
  | "fixed_capital_formation_public_enterprise"
  | "inventory_change"
  | "net_external_demand_total"
  | "exports"
  | "imports";

/**
 * One quarter of 主計總處 GDP for one expenditure component — its contribution to growth in percentage
 * points. (A yoyChangePercent field existed for a few hours on 2026-09-22 and was removed upstream the same
 * day, analysis-ts 7e4b4358 — deliberately not modelled here.)
 */
export interface GdpEntry {
  period: string;
  year: number;
  quarter: number;
  contributionPoints: number | null;
}

export interface GdpResult {
  /** The category actually applied (defaults to "growth_rate" upstream when omitted). */
  category: GdpCategory;
  entries: GdpEntry[];
}
