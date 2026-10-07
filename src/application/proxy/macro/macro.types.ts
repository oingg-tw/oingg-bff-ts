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

/**
 * 美國聯準會的政策利率目標區間。2026-09-29 新增，跟 CbcPolicyRate 對稱的事件序列（不是日頻）。
 *
 * 2008-12-16 之前只有單一目標值（upper 與 lower 相等）；那天從 1% 改成 0~0.25% 的區間，依上緣計為 -75。
 * `changeBp` 是**目標區間上緣**相對前一次調整的變化（25 = 升息一碼），完整歷史的第一筆是 null。
 */
export interface UsPolicyRateEntry {
  effectiveDate: string;
  targetUpper: number;
  targetLower: number;
  changeBp: number | null;
}

/**
 * 歐洲央行三大政策利率的調整事件。2026-09-29 新增，跟 UsPolicyRate／CbcPolicyRate 同一族。
 *
 * **三個利率都可以是 null**（不是每次調整三者都公布），而 `depositFacilityRate` **可以是負的**
 * （2014-06 ~ 2022-07 的負利率時期）——所以下游畫圖時 y 軸不能假設非負。
 *
 * `mainRefinancingIsMinimumBid` 是**純 boolean 不可為 null**：true 代表那段期間（2000-06-28 ~
 * 2008-10-14）的 MRO 是變動利率標售的「最低投標利率」而不是固定標售利率。數字本身仍然連續可畫，
 * 這個旗標只是告訴讀者那一段的語意不同。
 */
export interface EcbPolicyRateEntry {
  effectiveDate: string;
  depositFacilityRate: number | null;
  mainRefinancingRate: number | null;
  marginalLendingRate: number | null;
  mainRefinancingIsMinimumBid: boolean;
  depositFacilityChangeBp: number | null;
  mainRefinancingChangeBp: number | null;
  marginalLendingChangeBp: number | null;
}

/** Oldest to newest — 一列是一次調整，不是逐日序列。查無資料時 entries 是空陣列。 */
export interface EcbPolicyRateResult {
  entries: EcbPolicyRateEntry[];
}

/** Oldest to newest — 186 events from 1982-09-27 as of 2026-09-29 when unfiltered. */
export interface UsPolicyRateResult {
  entries: UsPolicyRateEntry[];
}

/**
 * 股票風險溢酬。**這支跟 macro 其他端點不同：回傳的是一組算出來的結論，不是時間序列。**
 *
 * 兩種算法並列，刻意不合併成一個數字：
 *   歷史法   erpGeometric / erpArithmetic ——「過去實際賺到的」減同期無風險利率
 *   供給面   supplySide.erp ——Ibbotson & Chen (2003)：通膨＋實質盈餘成長＋股利－無風險利率
 * 兩者在 2026-09-29 的完整窗口分別是 5.51% 與 5.10%，差距不大；但歷史法的算術版是 7.66%，
 * **跟幾何版差 2.15 個百分點**，而選哪一個會改變任何 CAPM 折現的結果。
 *
 * 幾乎每個數值欄位都可為 null（窗口內沒有重疊資料時），`supplySide` **整塊**也可以是 null。
 * `peGrowth` 永遠是 0——那是模型的假設（本益比擴張不算公司供給的報酬），不是「沒有資料」。
 */
export interface EquityRiskPremiumQuery {
  startYear?: number;
  startMonth?: number;
  endYear?: number;
  endMonth?: number;
}

export interface EquityRiskPremiumSupplySide {
  erp: number | null;
  expectedInflation: number | null;
  realEarningsGrowth: number | null;
  peGrowth: number;
  dividendYield: number | null;
  riskFreeRate: number | null;
  inflationMonths: number;
  gdpQuarters: number;
  dividendYieldTradeDate: string | null;
  dividendYieldCompanyCount: number;
  dividendYieldMarketCapCoverage: number | null;
}

export interface EquityRiskPremiumDateRange {
  min: string | null;
  max: string | null;
}

export interface EquityRiskPremiumResult {
  windowStart: string | null;
  windowEnd: string | null;
  months: number;
  marketReturnGeometric: number | null;
  marketReturnArithmetic: number | null;
  avgRiskFreeRate: number | null;
  erpGeometric: number | null;
  erpArithmetic: number | null;
  requestedWindow: { startYear?: number; startMonth?: number; endYear?: number; endMonth?: number };
  /** 只有「呼叫端指定了窗口、而那個窗口被裁切」時才是 true；不帶參數時預設窗口本來就是交集，必然 false。 */
  clippedToAvailableData: boolean;
  dataCoverage: { taiexDateRange: EquityRiskPremiumDateRange; riskFreeRateDateRange: EquityRiskPremiumDateRange };
  fieldStatuses: Record<string, unknown>;
  warnings: string[];
  supplySide: EquityRiskPremiumSupplySide | null;
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
  /** Each value is a { status, message } object, passed through as-is. */
  fieldStatuses: Record<string, unknown>;
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

/**
 * One month of the CBC's 集中市場 monthly summary (via gov-ts) — listed-company count, total par/market
 * value, trading value (total and average daily), and the month's average TAIEX with its YoY %. Monetary
 * figures are NT$ million. Full history from 1987-05 (471 rows as of 2026-09-22). Added for web-nuxt's
 * 大事件年表 page.
 */
export interface StockMarketSummaryEntry {
  period: string;
  year: number;
  month: number;
  listedCompanies: number | null;
  totalParValue: number | null;
  totalMarketValue: number | null;
  totalTradingValue: number | null;
  avgDailyTradingValue: number | null;
  avgTaiex: number | null;
  avgTaiexYoyPercent: number | null;
}

export interface StockMarketSummaryResult {
  entries: StockMarketSummaryEntry[];
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

/**
 * 五大銀行存款利率（CBC EG2BM01en，gov-ts 2026-10-07 收進來），月資料，**年利率百分比**（1.7 ＝ 1.7%）。
 * 給 /holdings/performance 的無風險利率用（使用者經 GOV 定案：一年期定存）。
 */
export interface FiveMajorBankRateEntry {
  /** "YYYY-MM" */
  period: string;
  year: number;
  month: number;
  depositRate1mPct: number | null;
  depositRate1yPct: number | null;
  baseLendingRatePct: number | null;
}

export interface FiveMajorBankRateResult {
  /** 整段最新的一個月，不受 from 影響。通常落後一到兩個月（CBC 月報每月 25 日前後補上個月）。 */
  latestPeriod: string | null;
  entries: FiveMajorBankRateEntry[];
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
