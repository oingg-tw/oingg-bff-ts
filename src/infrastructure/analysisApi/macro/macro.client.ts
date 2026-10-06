import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  BusinessCycleIndicatorEntry,
  BusinessCycleIndicatorResult,
  CbcPolicyRateEntry,
  EcbPolicyRateEntry,
  EquityRiskPremiumDateRange,
  EquityRiskPremiumQuery,
  EquityRiskPremiumResult,
  EquityRiskPremiumSupplySide,
  UsPolicyRateEntry,
  CbcPolicyRateResult,
  EcbPolicyRateResult,
  UsPolicyRateResult,
  CpiCategory,
  CpiEntry,
  CpiResult,
  GdpCategory,
  GdpEntry,
  GdpResult,
  GovBondYield10yHistoryEntry,
  GovBondYield10yHistoryResult,
  GovBondYield10yResult,
  MonetaryAggregateEntry,
  MonetaryAggregateResult,
  StockMarketSummaryEntry,
  StockMarketSummaryResult,
  UsdTwdRateEntry,
  UsdTwdRateInterval,
  UsdTwdRateResult,
} from "@/application/proxy/macro/macro.types.js";
import type { MacroGatewayPort } from "@/application/ports/macroGateway.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Every macro series endpoint returns `{ entries: [...] }` (some with extra top-level fields) — this
 * fetches, checks the upstream status, and asserts the array is there, returning the raw body for the
 * caller to normalize. Only omits undefined params from the query so a caller that passes nothing keeps
 * the bare upstream request.
 */
async function getEntriesBody(
  path: string,
  params: Record<string, string | undefined>,
  label: string,
): Promise<{ body: Record<string, unknown>; entries: unknown[] }> {
  const searchParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams[key] = value;
    }
  }

  const url = buildAnalysisServiceUrl(path, Object.keys(searchParams).length > 0 ? searchParams : undefined);
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, label);

  const body: unknown = await response.json();
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) {
    logger.error({ url: url.toString() }, `${label} response is missing an entries array`);
    throw new AppError(`${label} response is missing an entries array`, 502);
  }

  return { body: body as Record<string, unknown>, entries };
}

function normalizeCbcPolicyRateEntry(raw: unknown): CbcPolicyRateEntry {
  const r = raw as Record<string, unknown>;
  return {
    effectiveDate: String(r.effectiveDate),
    discountRate: Number(r.discountRate),
    collateralAccommodationRate: Number(r.collateralAccommodationRate),
    unsecuredAccommodationRate: Number(r.unsecuredAccommodationRate),
    changeBp: toNumberOrNull(r.changeBp),
  };
}

/**
 * Fetches the CBC policy-rate event series from analysis-ts's GET /macro/cbc-policy-rate — added 2026-09-21
 * for web-nuxt's "TAIEX overlaid with rate-hike/cut events" chart (pair with GET /market/taiex-daily-price's
 * `interval=monthly`, since the rate history reaches 1989 and daily TAIEX only reaches ~2018 within its
 * row limit). `from` ("YYYY-MM-DD") keeps only events with effectiveDate >= that day; omitted returns the
 * whole history. Format is validated locally before this is called (see macro.service.ts) — analysis-ts
 * 400s on a malformed value too, this just avoids the round trip.
 */
export async function fetchCbcPolicyRate(from?: string): Promise<CbcPolicyRateResult> {
  const { entries } = await getEntriesBody("/macro/cbc-policy-rate", { from }, "CBC policy rate endpoint");
  return { entries: entries.map(normalizeCbcPolicyRateEntry) };
}

function normalizeUsPolicyRateEntry(raw: unknown): UsPolicyRateEntry {
  const r = raw as Record<string, unknown>;
  return {
    effectiveDate: String(r.effectiveDate),
    targetUpper: Number(r.targetUpper),
    targetLower: Number(r.targetLower),
    changeBp: toNumberOrNull(r.changeBp),
  };
}

/**
 * 美國聯準會政策利率的事件序列，來自 analysis-ts 的 GET /macro/us-policy-rate（2026-09-29 新增，資料源
 * 是 gov-ts 的 export.us_policy_rate）。跟 fetchCbcPolicyRate 同一個形狀與同一組慣例。
 *
 * `changeBp` 用 toNumberOrNull 而不是 Number：完整歷史的第一筆（1982-09-27）是 null，而 `Number(null)`
 * 會變成 0——那會把「沒有前一次可比」說成「這次沒有調整」，是兩件完全不同的事。
 */
export async function fetchUsPolicyRate(from?: string): Promise<UsPolicyRateResult> {
  const { entries } = await getEntriesBody("/macro/us-policy-rate", { from }, "US policy rate endpoint");
  return { entries: entries.map(normalizeUsPolicyRateEntry) };
}

function normalizeEcbPolicyRateEntry(raw: unknown): EcbPolicyRateEntry {
  const r = raw as Record<string, unknown>;
  return {
    effectiveDate: String(r.effectiveDate),
    depositFacilityRate: toNumberOrNull(r.depositFacilityRate),
    mainRefinancingRate: toNumberOrNull(r.mainRefinancingRate),
    marginalLendingRate: toNumberOrNull(r.marginalLendingRate),
    // `=== true` 不是 Boolean()：畸形回應下 Boolean(undefined) 是 false，讀起來跟「上游明確說 false」
    // 一模一樣。同一條規則在 isEmerging 上有過血淚（見 CLAUDE.md）。
    mainRefinancingIsMinimumBid: r.mainRefinancingIsMinimumBid === true,
    depositFacilityChangeBp: toNumberOrNull(r.depositFacilityChangeBp),
    mainRefinancingChangeBp: toNumberOrNull(r.mainRefinancingChangeBp),
    marginalLendingChangeBp: toNumberOrNull(r.marginalLendingChangeBp),
  };
}

/**
 * 歐洲央行三大政策利率的事件序列，來自 analysis-ts 的 GET /macro/ecb-policy-rate（2026-09-29 新增）。
 * 跟 fetchUsPolicyRate 同一個形狀與同一組慣例。
 *
 * 六個數值欄位全部走 toNumberOrNull：三個利率不是每次調整都公布，三個 changeBp 的第一筆沒有前值可比。
 * `Number(null)` 會把這兩種「沒有」都變成 0——在利率圖上那是一條假的零線與一個假的「未調整」。
 */
export async function fetchEcbPolicyRate(from?: string): Promise<EcbPolicyRateResult> {
  const { entries } = await getEntriesBody("/macro/ecb-policy-rate", { from }, "ECB policy rate endpoint");
  return { entries: entries.map(normalizeEcbPolicyRateEntry) };
}

function normalizeDateRange(raw: unknown): EquityRiskPremiumDateRange {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { min: toStringOrNull(r.min), max: toStringOrNull(r.max) };
}

function normalizeSupplySide(raw: unknown): EquityRiskPremiumSupplySide | null {
  // **整塊可以是 null**（加權指數與公債殖利率完全沒有重疊月份時），不是每個欄位各自 null。
  if (raw === null || raw === undefined) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  return {
    erp: toNumberOrNull(r.erp),
    expectedInflation: toNumberOrNull(r.expectedInflation),
    realEarningsGrowth: toNumberOrNull(r.realEarningsGrowth),
    // peGrowth 是模型固定的 0（本益比成長不算公司供給的報酬），不是缺值——所以走 Number 不是
    // toNumberOrNull：它若變成 null 會讓下游誤以為「這一項算不出來」，而實際上它永遠算得出來且等於 0。
    peGrowth: Number(r.peGrowth),
    dividendYield: toNumberOrNull(r.dividendYield),
    riskFreeRate: toNumberOrNull(r.riskFreeRate),
    inflationMonths: Number(r.inflationMonths),
    gdpQuarters: Number(r.gdpQuarters),
    dividendYieldTradeDate: toStringOrNull(r.dividendYieldTradeDate),
    dividendYieldCompanyCount: Number(r.dividendYieldCompanyCount),
    dividendYieldMarketCapCoverage: toNumberOrNull(r.dividendYieldMarketCapCoverage),
  };
}

/**
 * 股票風險溢酬，來自 analysis-ts 的 GET /macro/equity-risk-premium。
 *
 * **這支跟 macro 其他端點不同**：回傳的是一組算出來的結論而不是 `{ entries }`，所以不能用
 * getEntriesBody，自己組 URL 與解析。四個窗口參數**只在有給的時候才轉發**（省略時上游用完整重疊區間，
 * 而多送一個 undefined 會讓回應的 requestedWindow 多出一個 key）。
 *
 * `fieldStatuses` 是 `Record<string, unknown>` 而不是逐欄位正規化：它只在有值為 null 時才出現對應的
 * key，內容是上游的 metricStatus 形狀。這一層對它沒有任何判斷，原樣轉發比宣告一個會過期的形狀安全。
 */
export async function fetchEquityRiskPremium(query: EquityRiskPremiumQuery): Promise<EquityRiskPremiumResult> {
  const searchParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      searchParams[key] = String(value);
    }
  }

  const url = buildAnalysisServiceUrl("/macro/equity-risk-premium", Object.keys(searchParams).length > 0 ? searchParams : undefined);
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, "Equity risk premium endpoint");

  const body = (await response.json()) as Record<string, unknown>;
  const coverage = (body.dataCoverage ?? {}) as Record<string, unknown>;
  return {
    windowStart: toStringOrNull(body.windowStart),
    windowEnd: toStringOrNull(body.windowEnd),
    months: Number(body.months),
    marketReturnGeometric: toNumberOrNull(body.marketReturnGeometric),
    marketReturnArithmetic: toNumberOrNull(body.marketReturnArithmetic),
    avgRiskFreeRate: toNumberOrNull(body.avgRiskFreeRate),
    erpGeometric: toNumberOrNull(body.erpGeometric),
    erpArithmetic: toNumberOrNull(body.erpArithmetic),
    requestedWindow: (body.requestedWindow ?? {}) as EquityRiskPremiumResult["requestedWindow"],
    clippedToAvailableData: body.clippedToAvailableData === true,
    dataCoverage: {
      taiexDateRange: normalizeDateRange(coverage.taiexDateRange),
      riskFreeRateDateRange: normalizeDateRange(coverage.riskFreeRateDateRange),
    },
    fieldStatuses: (body.fieldStatuses ?? {}) as Record<string, unknown>,
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
    supplySide: normalizeSupplySide(body.supplySide),
  };
}

function normalizeBusinessCycleIndicatorEntry(raw: unknown): BusinessCycleIndicatorEntry {
  const r = raw as Record<string, unknown>;
  return {
    period: String(r.period),
    year: Number(r.year),
    month: Number(r.month),
    leadingIndexComposite: toNumberOrNull(r.leadingIndexComposite),
    leadingIndexDetrended: toNumberOrNull(r.leadingIndexDetrended),
    coincidentIndexComposite: toNumberOrNull(r.coincidentIndexComposite),
    coincidentIndexDetrended: toNumberOrNull(r.coincidentIndexDetrended),
    laggingIndexComposite: toNumberOrNull(r.laggingIndexComposite),
    laggingIndexDetrended: toNumberOrNull(r.laggingIndexDetrended),
    signalScore: toNumberOrNull(r.signalScore),
    signalLight: toStringOrNull(r.signalLight),
  };
}

/** 國發會 景氣指標 + 景氣對策信號, monthly from 1982-01 — GET /macro/business-cycle-indicator. */
export async function fetchBusinessCycleIndicator(from?: string): Promise<BusinessCycleIndicatorResult> {
  const { entries } = await getEntriesBody("/macro/business-cycle-indicator", { from }, "Business cycle indicator endpoint");
  return { entries: entries.map(normalizeBusinessCycleIndicatorEntry) };
}

function normalizeMonetaryAggregateEntry(raw: unknown): MonetaryAggregateEntry {
  const r = raw as Record<string, unknown>;
  return {
    period: String(r.period),
    year: Number(r.year),
    month: Number(r.month),
    m1aAmount: toNumberOrNull(r.m1aAmount),
    m1aYoyPercent: toNumberOrNull(r.m1aYoyPercent),
    m1bAmount: toNumberOrNull(r.m1bAmount),
    m1bYoyPercent: toNumberOrNull(r.m1bYoyPercent),
    m2Amount: toNumberOrNull(r.m2Amount),
    m2YoyPercent: toNumberOrNull(r.m2YoyPercent),
  };
}

/** 央行 M1A/M1B/M2 monthly — GET /macro/monetary-aggregate. */
export async function fetchMonetaryAggregate(from?: string): Promise<MonetaryAggregateResult> {
  const { entries } = await getEntriesBody("/macro/monetary-aggregate", { from }, "Monetary aggregate endpoint");
  return { entries: entries.map(normalizeMonetaryAggregateEntry) };
}

function normalizeGovBondYield10yHistoryEntry(raw: unknown): GovBondYield10yHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    period: String(r.period),
    year: Number(r.year),
    month: Number(r.month),
    yieldPct: toNumberOrNull(r.yieldPct),
  };
}

/**
 * Latest 10-year 公債殖利率 snapshot — GET /macro/gov-bond-yield-10y (the pre-existing point-in-time
 * endpoint; unlike the series endpoints it has no `entries`, so it doesn't go through getEntriesBody).
 */
export async function fetchGovBondYield10y(): Promise<GovBondYield10yResult> {
  const url = buildAnalysisServiceUrl("/macro/gov-bond-yield-10y");
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, "Gov bond yield 10y endpoint");

  const body = (await response.json()) as Record<string, unknown> | null;
  if (typeof body !== "object" || body === null || !("yieldPct" in body)) {
    logger.error({ url: url.toString() }, "Gov bond yield 10y endpoint response is missing yieldPct");
    throw new AppError("Gov bond yield 10y endpoint response is missing yieldPct", 502);
  }

  const rawStatuses = body.fieldStatuses;
  // 每個值是 { status, message } 物件，不是字串——原本的 String(value) 會把它變成 "[object Object]"
  // （2026-10-07 對過上游 OpenAPI；當時剛好一直是空物件所以沒人看到）。跟 equity-risk-premium 一樣原樣轉發。
  const fieldStatuses: Record<string, unknown> =
    typeof rawStatuses === "object" && rawStatuses !== null ? { ...(rawStatuses as Record<string, unknown>) } : {};

  return {
    yieldPct: toNumberOrNull(body.yieldPct),
    asOfMonth: toStringOrNull(body.asOfMonth),
    fieldStatuses,
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}

function normalizeStockMarketSummaryEntry(raw: unknown): StockMarketSummaryEntry {
  const r = raw as Record<string, unknown>;
  return {
    period: String(r.period),
    year: Number(r.year),
    month: Number(r.month),
    listedCompanies: toNumberOrNull(r.listedCompanies),
    totalParValue: toNumberOrNull(r.totalParValue),
    totalMarketValue: toNumberOrNull(r.totalMarketValue),
    totalTradingValue: toNumberOrNull(r.totalTradingValue),
    avgDailyTradingValue: toNumberOrNull(r.avgDailyTradingValue),
    avgTaiex: toNumberOrNull(r.avgTaiex),
    avgTaiexYoyPercent: toNumberOrNull(r.avgTaiexYoyPercent),
  };
}

/**
 * CBC 集中市場 monthly summary from 1987-05 — GET /macro/stock-market-summary. Pure pass-through: no
 * resampling and no merging with the daily TAIEX series — `avgTaiex` is a monthly AVERAGE, not a
 * month-end close, so it must never be stitched onto GET /market/taiex-daily-price's closes as one line.
 */
export async function fetchStockMarketSummary(from?: string): Promise<StockMarketSummaryResult> {
  const { entries } = await getEntriesBody("/macro/stock-market-summary", { from }, "Stock market summary endpoint");
  return { entries: entries.map(normalizeStockMarketSummaryEntry) };
}

/** 10-year 公債殖利率 monthly history — GET /macro/gov-bond-yield-10y-history. */
export async function fetchGovBondYield10yHistory(from?: string): Promise<GovBondYield10yHistoryResult> {
  const { entries } = await getEntriesBody("/macro/gov-bond-yield-10y-history", { from }, "Gov bond yield 10y history endpoint");
  return { entries: entries.map(normalizeGovBondYield10yHistoryEntry) };
}

function normalizeUsdTwdRateEntry(raw: unknown): UsdTwdRateEntry {
  const r = raw as Record<string, unknown>;
  return {
    tradeDate: String(r.tradeDate),
    bankBuyingRate: toNumberOrNull(r.bankBuyingRate),
    bankSellingRate: toNumberOrNull(r.bankSellingRate),
    interbankClosingRate: toNumberOrNull(r.interbankClosingRate),
  };
}

/**
 * USD/TWD daily series — GET /macro/usd-twd-rate. Same `limit` (1-2000, default 250) and `interval`
 * (daily/weekly/monthly, default daily) semantics as GET /market/taiex-daily-price; both are only sent when
 * given so the bare call keeps the upstream defaults.
 */
export async function fetchUsdTwdRate(limit?: number, interval?: UsdTwdRateInterval): Promise<UsdTwdRateResult> {
  const { entries } = await getEntriesBody(
    "/macro/usd-twd-rate",
    { limit: limit !== undefined ? String(limit) : undefined, interval },
    "USD/TWD rate endpoint",
  );
  return { entries: entries.map(normalizeUsdTwdRateEntry) };
}

function normalizeCpiEntry(raw: unknown): CpiEntry {
  const r = raw as Record<string, unknown>;
  return {
    period: String(r.period),
    year: Number(r.year),
    month: Number(r.month),
    indexValue: toNumberOrNull(r.indexValue),
    yoyChangePercent: toNumberOrNull(r.yoyChangePercent),
  };
}

/** 主計總處 CPI monthly, one basket category per call (default "total" upstream) — GET /macro/cpi. */
export async function fetchCpi(from?: string, category?: CpiCategory): Promise<CpiResult> {
  const { body, entries } = await getEntriesBody("/macro/cpi", { from, category }, "CPI endpoint");
  if (typeof body.category !== "string") {
    throw new AppError("CPI endpoint response is missing a category string", 502);
  }
  return { category: body.category as CpiCategory, entries: entries.map(normalizeCpiEntry) };
}

function normalizeGdpEntry(raw: unknown): GdpEntry {
  const r = raw as Record<string, unknown>;
  return {
    period: String(r.period),
    year: Number(r.year),
    quarter: Number(r.quarter),
    contributionPoints: toNumberOrNull(r.contributionPoints),
  };
}

/** 主計總處 GDP quarterly, one expenditure component per call (default "growth_rate" upstream) — GET /macro/gdp. */
export async function fetchGdp(from?: string, category?: GdpCategory): Promise<GdpResult> {
  const { body, entries } = await getEntriesBody("/macro/gdp", { from, category }, "GDP endpoint");
  if (typeof body.category !== "string") {
    throw new AppError("GDP endpoint response is missing a category string", 502);
  }
  return { category: body.category as GdpCategory, entries: entries.map(normalizeGdpEntry) };
}

/**
 * MacroGatewayPort 的實作。這一層底下的 fetchX 函式已經做完正規化與 502 判定，所以這裡只是把它們對應到
 * port 的方法名；重構前中間還隔著一支 macro.service.ts，但那支檔案每個函式都是 `getX(a) => fetchX(a)`，
 * 沒有任何驗證或編排（macro 的參數驗證全在 route 的 zod schema，那份 schema 同時是 OpenAPI 的來源）。
 * 代理切片只要是純轉發，就不該為了湊滿分層而留一層空殼。
 */
export const analysisMacroGateway: MacroGatewayPort = {
  getCbcPolicyRate: fetchCbcPolicyRate,
  getUsPolicyRate: fetchUsPolicyRate,
  getEcbPolicyRate: fetchEcbPolicyRate,
  getEquityRiskPremium: fetchEquityRiskPremium,
  getBusinessCycleIndicator: fetchBusinessCycleIndicator,
  getMonetaryAggregate: fetchMonetaryAggregate,
  getGovBondYield10y: fetchGovBondYield10y,
  getGovBondYield10yHistory: fetchGovBondYield10yHistory,
  getStockMarketSummary: fetchStockMarketSummary,
  getUsdTwdRate: fetchUsdTwdRate,
  getCpi: fetchCpi,
  getGdp: fetchGdp,
};
