import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";
import {
  businessCycleIndicatorQuerySchema,
  cbcPolicyRateQuerySchema,
  usPolicyRateQuerySchema,
  ecbPolicyRateQuerySchema,
  equityRiskPremiumQuerySchema,
  CPI_CATEGORIES,
  cpiQuerySchema,
  GDP_CATEGORIES,
  gdpQuerySchema,
  govBondYield10yHistoryQuerySchema,
  monetaryAggregateQuerySchema,
  stockMarketSummaryQuerySchema,
  usdTwdRateQuerySchema,
} from "@/http/modules/macro/route.js";

const upstream502 = errorResponse("analysis-ts 服務無法連線或回應格式異常。");
const nullableNumber = z.number().nullable();

const monthlyPeriodFields = { period: z.string(), year: z.number(), month: z.number() };

// --- cbc-policy-rate ---
const cbcPolicyRateEntrySchema = z.object({
  effectiveDate: z.string(),
  discountRate: z.number(),
  collateralAccommodationRate: z.number(),
  unsecuredAccommodationRate: z.number(),
  changeBp: nullableNumber,
});

const cbcPolicyRateResultSchema = z
  .object({ entries: z.array(cbcPolicyRateEntrySchema) })
  .openapi("CbcPolicyRateResult", {
    example: {
      entries: [
        { effectiveDate: "2022-03-18", discountRate: 1.375, collateralAccommodationRate: 1.75, unsecuredAccommodationRate: 3.625, changeBp: 25 },
        { effectiveDate: "2022-06-17", discountRate: 1.5, collateralAccommodationRate: 1.875, unsecuredAccommodationRate: 3.75, changeBp: 12.5 },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/cbc-policy-rate",
  summary: "中央銀行政策利率調整事件序列（重貼現率／擔保放款融通利率／短期融通利率）——給大盤疊加升降息事件圖用",
  description:
    "資料來自 oingg-analysis-ts 的 GET /macro/cbc-policy-rate（2026-09-21 新增）。**事件型序列**：一列代表一次利率調整，不是逐日資料；由舊到新排序，不帶 from 時回傳 1989-04-01 起全部歷史（目前 77 筆）。三個利率欄位都是百分比數字（2 代表 2%），原樣轉發 analysis-ts 的 JSON 數字。changeBp 是重貼現率相對「前一次調整」的變動，單位是基點（12.5 = 半碼、25 = 一碼）——**整段歷史的第一筆（1989-04-01）是 null**（沒有更早的可比較）；帶 from 縮小窗口時，窗口內第一筆的 changeBp 仍會有值（它的前一次調整在上游存在，只是不在回傳範圍裡）。from 選填，\"YYYY-MM-DD\"，只回生效日 >= 這天的事件，格式錯誤會 400（本服務先擋，不打上游）。搭配 GET /market/taiex-daily-price 的 interval=monthly 使用——利率事件回到 1989，而 TAIEX 日線在 2000 筆上限內只能回到約 2018 年中，month 線（約 333 筆）才涵蓋得到 2000 年後每一輪升降息循環。",
  tags: ["Macro"],
  request: { query: cbcPolicyRateQuerySchema.openapi("CbcPolicyRateQuery", { example: { from: "2020-01-01" } }) },
  responses: {
    200: { description: "利率調整事件清單，由舊到新。", content: { "application/json": { schema: cbcPolicyRateResultSchema } } },
    400: errorResponse('from 不是 "YYYY-MM-DD" 格式。'),
    502: upstream502,
  },
});

// --- us-policy-rate ---
const usPolicyRateEntrySchema = z.object({
  effectiveDate: z.string(),
  targetUpper: z.number(),
  targetLower: z.number(),
  changeBp: nullableNumber,
});

const usPolicyRateResultSchema = z
  .object({ entries: z.array(usPolicyRateEntrySchema) })
  .openapi("UsPolicyRateResult", {
    example: {
      entries: [
        { effectiveDate: "2024-09-19", targetUpper: 5, targetLower: 4.75, changeBp: -50 },
        { effectiveDate: "2026-09-17", targetUpper: 4, targetLower: 3.75, changeBp: 25 },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/us-policy-rate",
  summary: "美國聯準會政策利率目標區間的調整事件序列——給大盤疊加美國升降息事件、或跟台灣利率對照用",
  description:
    "資料來自 oingg-analysis-ts 的 GET /macro/us-policy-rate（2026-09-29 新增，上游資料源是 gov-ts 的 export.us_policy_rate）。**事件型序列**：一列代表一次調整，不是逐日資料；由舊到新排序，不帶 from 時回傳 1982-09-27 起全部歷史（實測 186 筆，最新一筆 2026-09-17）。targetUpper／targetLower 是百分比數字（4 代表 4%），原樣轉發上游的 JSON 數字。" +
    "**2008-12-16 之前只有單一目標值**，那段期間 targetUpper 與 targetLower 相等；那天從 1% 改成 0~0.25% 的區間，依上緣計為 -75。" +
    "changeBp 是**目標區間上緣**相對前一次調整的變動，單位是基點（25 = 一碼、-50 = 降息兩碼）——**整段歷史的第一筆（1982-09-27）是 null**（沒有更早的可比較）；帶 from 縮小窗口時，窗口內第一筆的 changeBp 仍會有值，理由跟 /macro/cbc-policy-rate 相同。from 選填，\"YYYY-MM-DD\"，只回生效日 >= 這天的事件，格式錯誤會 400（本服務先擋，不打上游）。" +
    "**這是政策利率，不是公債殖利率，不能直接當無風險利率用**——要無風險利率請看 GET /macro/gov-bond-yield-10y（台灣十年期公債）。跟 /macro/cbc-policy-rate 並排時注意兩者的欄位語意不同：台灣那支是三個政策工具利率（重貼現率等），這支是一個目標區間的上下緣。",
  tags: ["Macro"],
  request: { query: usPolicyRateQuerySchema.openapi("UsPolicyRateQuery", { example: { from: "2024-06-01" } }) },
  responses: {
    200: { description: "美國政策利率調整事件清單，由舊到新。", content: { "application/json": { schema: usPolicyRateResultSchema } } },
    400: errorResponse('from 不是 "YYYY-MM-DD" 格式。'),
    502: upstream502,
  },
});

// --- equity-risk-premium ---
const erpDateRangeSchema = z.object({ min: z.string().nullable(), max: z.string().nullable() });

const erpSupplySideSchema = z.object({
  erp: nullableNumber,
  expectedInflation: nullableNumber,
  realEarningsGrowth: nullableNumber,
  peGrowth: z.number(),
  dividendYield: nullableNumber,
  riskFreeRate: nullableNumber,
  inflationMonths: z.number(),
  gdpQuarters: z.number(),
  dividendYieldTradeDate: z.string().nullable(),
  dividendYieldCompanyCount: z.number(),
  dividendYieldMarketCapCoverage: nullableNumber,
});

const equityRiskPremiumResultSchema = z
  .object({
    windowStart: z.string().nullable(),
    windowEnd: z.string().nullable(),
    months: z.number(),
    marketReturnGeometric: nullableNumber,
    marketReturnArithmetic: nullableNumber,
    avgRiskFreeRate: nullableNumber,
    erpGeometric: nullableNumber,
    erpArithmetic: nullableNumber,
    requestedWindow: z.object({
      startYear: z.number().optional(),
      startMonth: z.number().optional(),
      endYear: z.number().optional(),
      endMonth: z.number().optional(),
    }),
    clippedToAvailableData: z.boolean(),
    dataCoverage: z.object({ taiexDateRange: erpDateRangeSchema, riskFreeRateDateRange: erpDateRangeSchema }),
    fieldStatuses: z.record(z.string(), z.unknown()),
    warnings: z.array(z.string()),
    supplySide: erpSupplySideSchema.nullable(),
  })
  .openapi("EquityRiskPremiumResult", {
    example: {
      windowStart: "1999-01", windowEnd: "2026-07", months: 331,
      marketReturnGeometric: 7.4362, marketReturnArithmetic: 9.5851, avgRiskFreeRate: 1.9256,
      erpGeometric: 5.5106, erpArithmetic: 7.6595,
      requestedWindow: {}, clippedToAvailableData: false,
      dataCoverage: { taiexDateRange: { min: "1999-01", max: "2026-09" }, riskFreeRateDateRange: { min: "1994-12", max: "2026-07" } },
      fieldStatuses: {}, warnings: [],
      supplySide: { erp: 5.1015, expectedInflation: 1.151, realEarningsGrowth: 4.2091, peGrowth: 0, dividendYield: 1.5929, riskFreeRate: 1.9, inflationMonths: 331, gdpQuarters: 110, dividendYieldTradeDate: "2026-09-24", dividendYieldCompanyCount: 1058, dividendYieldMarketCapCoverage: 100 },
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/equity-risk-premium",
  summary: "股票風險溢酬（歷史法與供給面模型兩種算法並列）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /macro/equity-risk-premium（2026-09-29 轉發）。**這支跟 /macro 其他端點不同：回傳的是一組算出來的結論，不是時間序列。**" +
    "**兩種算法刻意並列，不要自己挑一個當「正確答案」**：`erpGeometric`／`erpArithmetic` 是歷史法（加權指數年化報酬減同期十年期公債殖利率平均）；`supplySide.erp` 是 Ibbotson & Chen (2003) 的供給面模型（通膨＋實質盈餘成長＋股利，本益比成長設 0，再減無風險利率）。2026-09-29 完整窗口實測：歷史法幾何 5.51%、供給面 5.10%、歷史法算術 7.66%。" +
    "**幾何與算術差 2.15 個百分點，而這個差會直接改變任何 CAPM 折現的結果**——要用哪一個是取捨不是細節：算術平均適合單期期望值，幾何平均適合多期複利，長期折現多半用幾何。" +
    "`supplySide.peGrowth` **永遠是 0**，那是模型的假設（本益比擴張不算公司供給的報酬），不是「算不出來」。`supplySide` **整塊可以是 null**（加權指數與公債殖利率完全沒有重疊月份時），其中 `erp` 與 `dividendYield` 也可各自為 null（上市公司有市值的不到九成時不算殖利率，原因會寫在 warnings）。" +
    "四個窗口參數 startYear／startMonth／endYear／endMonth 全部選填，但**年與月必須成對**（只給一邊會 400，本服務先擋不打上游）；全部省略時窗口是兩種資料的完整重疊區間。**`clippedToAvailableData` 只描述「呼叫端指定的窗口被裁切」**——不帶參數時預設窗口本來就是交集，所以必然是 false，不要把它當成「資料完整」的指標。" +
    "要看完整可用範圍請同時看 `dataCoverage` 的**兩個** range：實測加權指數到 2026-09、公債殖利率只到 2026-07，所以 windowEnd 是 2026-07——只看其中一個會以為窗口莫名其妙短了兩個月。" +
    "`supplySide.dividendYield` 是**最新交易日的市值加權**（沒有長期歷史可平均），跟通膨／成長用整段窗口平均不同；`realEarningsGrowth` 用實質 GDP 成長近似盈餘成長，上游自己標明那會因新股稀釋而**高估**。" +
    "**2026-09-30 起 dividendYieldCompanyCount 與 Coverage 會明顯變大，那是定義變了不是資料修好了**：證交所從 2026-08-28 起對不配息的上市公司改成不填殖利率，analysis-ts 把空白讀成 0，所以不配息的公司從「不在母體」變成「在母體、值為 0」。實測 dividendYieldCompanyCount 從 829 變成 1,058（+229）、dividendYieldMarketCapCoverage 從 98.3966 變成 100。因為這是市值加權而原本已涵蓋 98.4% 的市值，`supplySide.dividendYield` 本身只會小幅下降（實測 1.5929 -> 1.5672），`supplySide.erp` 也只小幅變動——**但 Coverage 到達 100% 之後就不再是一個有鑑別力的健康指標了**，別再用它判斷殖利率資料是否完整。",
  tags: ["Macro"],
  request: { query: equityRiskPremiumQuerySchema.openapi("EquityRiskPremiumQuery", { example: { startYear: 2015, startMonth: 1, endYear: 2020, endMonth: 12 } }) },
  responses: {
    200: { description: "風險溢酬計算結果。", content: { "application/json": { schema: equityRiskPremiumResultSchema } } },
    400: errorResponse("年與月沒有成對給、或不是整數／月份不在 1~12。"),
    502: upstream502,
  },
});

// --- ecb-policy-rate ---
const ecbPolicyRateEntrySchema = z.object({
  effectiveDate: z.string(),
  depositFacilityRate: nullableNumber,
  mainRefinancingRate: nullableNumber,
  marginalLendingRate: nullableNumber,
  mainRefinancingIsMinimumBid: z.boolean(),
  depositFacilityChangeBp: nullableNumber,
  mainRefinancingChangeBp: nullableNumber,
  marginalLendingChangeBp: nullableNumber,
});

const ecbPolicyRateResultSchema = z
  .object({ entries: z.array(ecbPolicyRateEntrySchema) })
  .openapi("EcbPolicyRateResult", {
    example: {
      entries: [
        { effectiveDate: "2022-07-27", depositFacilityRate: 0, mainRefinancingRate: 0.5, marginalLendingRate: 0.75, mainRefinancingIsMinimumBid: false, depositFacilityChangeBp: 50, mainRefinancingChangeBp: 50, marginalLendingChangeBp: 50 },
        { effectiveDate: "2024-06-12", depositFacilityRate: 3.75, mainRefinancingRate: 4.25, marginalLendingRate: 4.5, mainRefinancingIsMinimumBid: false, depositFacilityChangeBp: -25, mainRefinancingChangeBp: -25, marginalLendingChangeBp: -25 },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/ecb-policy-rate",
  summary: "歐洲央行三大政策利率的調整事件序列（存款機制／主要再融資／邊際貸款）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /macro/ecb-policy-rate（2026-09-29 新增，上游資料源是 gov-ts）。**事件型序列**：一列代表一次調整，不是逐日資料；由舊到新排序，查無資料時 entries 是空陣列。三個利率都是百分比數字（2.5 代表 2.5%），原樣轉發上游的 JSON 數字。" +
    "**三個利率都可能是 null**（不是每次調整三者都公布），而且 **depositFacilityRate 可以是負的**——2014-06 到 2022-07 是負利率時期，所以畫圖時 y 軸不能假設非負，這是這支跟 /macro/cbc-policy-rate、/macro/us-policy-rate 最大的不同。" +
    "三個 *ChangeBp 是各自利率相對前一次調整的變動（單位基點），**沒有前一次可比時是 null**（整段歷史的第一筆，以及某個利率首次出現的那一筆）。" +
    "**mainRefinancingIsMinimumBid** 是必定存在的布林值：true 代表那段期間（約 2000-06-28 ~ 2008-10-14）的 MRO 是變動利率標售的「最低投標利率」而不是固定標售利率——數字本身連續可畫，這個旗標只是說明那一段的語意不同，適合在圖上標註而不是拿來切斷線段。" +
    "from 選填，\"YYYY-MM-DD\"，只回生效日 >= 這天的事件，格式錯誤會 400（本服務先擋，不打上游）。",
  tags: ["Macro"],
  request: { query: ecbPolicyRateQuerySchema.openapi("EcbPolicyRateQuery", { example: { from: "2022-01-01" } }) },
  responses: {
    200: { description: "歐洲央行政策利率調整事件清單，由舊到新。", content: { "application/json": { schema: ecbPolicyRateResultSchema } } },
    400: errorResponse('from 不是 "YYYY-MM-DD" 格式。'),
    502: upstream502,
  },
});

// --- 總經特區 series (2026-09-22) ---
const SERIES_COMMON_NOTE =
  "資料來自 oingg-analysis-ts（2026-09-22 新增，給總經特區側邊欄跟大盤對照用）。entries 由舊到新，所有數值欄位都是 number | null（原樣轉發 JSON 數字）。";
const FROM_MONTH_NOTE = "from 選填，\"YYYY-MM\"，只回 period >= 該月的資料（含）；省略回傳全部歷史。格式錯誤會 400（本服務先擋，不打上游）。";
const badFromMonth = errorResponse('from 不是 "YYYY-MM" 格式。');

// --- business-cycle-indicator ---
const businessCycleIndicatorEntrySchema = z.object({
  ...monthlyPeriodFields,
  leadingIndexComposite: nullableNumber,
  leadingIndexDetrended: nullableNumber,
  coincidentIndexComposite: nullableNumber,
  coincidentIndexDetrended: nullableNumber,
  laggingIndexComposite: nullableNumber,
  laggingIndexDetrended: nullableNumber,
  signalScore: nullableNumber,
  signalLight: z.string().nullable(),
});

const businessCycleIndicatorResultSchema = z
  .object({ entries: z.array(businessCycleIndicatorEntrySchema) })
  .openapi("BusinessCycleIndicatorResult", {
    example: {
      entries: [
        {
          period: "2026-07", year: 2026, month: 7,
          leadingIndexComposite: 138.625, leadingIndexDetrended: 104.6337,
          coincidentIndexComposite: 141.5038, coincidentIndexDetrended: 106.805,
          laggingIndexComposite: 138.8361, laggingIndexDetrended: 104.7914,
          signalScore: 41, signalLight: "紅",
        },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/business-cycle-indicator",
  summary: "國發會景氣指標（領先／同時／落後，綜合與不含趨勢）與景氣對策信號，月序列",
  description: `${SERIES_COMMON_NOTE}三組指數各有「綜合指數」跟「不含趨勢指數」兩個版本；signalScore 是景氣對策信號綜合分數（9–45），signalLight 是對應燈號的中文字串（紅／黃紅／綠／黃藍／藍），原樣轉發不做映射。全歷史從 1982-01 起（約 535 筆）。${FROM_MONTH_NOTE}`,
  tags: ["Macro"],
  request: { query: businessCycleIndicatorQuerySchema.openapi("BusinessCycleIndicatorQuery", { example: { from: "2020-01" } }) },
  responses: {
    200: { description: "景氣指標月序列。", content: { "application/json": { schema: businessCycleIndicatorResultSchema } } },
    400: badFromMonth,
    502: upstream502,
  },
});

// --- monetary-aggregate ---
const monetaryAggregateEntrySchema = z.object({
  ...monthlyPeriodFields,
  m1aAmount: nullableNumber,
  m1aYoyPct: nullableNumber,
  m1bAmount: nullableNumber,
  m1bYoyPct: nullableNumber,
  m2Amount: nullableNumber,
  m2YoyPct: nullableNumber,
});

const monetaryAggregateResultSchema = z
  .object({ entries: z.array(monetaryAggregateEntrySchema) })
  .openapi("MonetaryAggregateResult", {
    example: {
      entries: [
        { period: "2026-07", year: 2026, month: 7, m1aAmount: 12716291, m1aYoyPct: 8.28, m1bAmount: 30530948, m1bYoyPct: 7.34, m2Amount: 70224762, m2YoyPct: 7.42 },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/monetary-aggregate",
  summary: "中央銀行貨幣總計數 M1A／M1B／M2（餘額與年增率），月序列",
  description: `${SERIES_COMMON_NOTE}*Amount 是期底餘額（新台幣百萬元），*YoyPercent 是年增率百分比。${FROM_MONTH_NOTE}`,
  tags: ["Macro"],
  request: { query: monetaryAggregateQuerySchema.openapi("MonetaryAggregateQuery", { example: { from: "2020-01" } }) },
  responses: {
    200: { description: "貨幣總計數月序列。", content: { "application/json": { schema: monetaryAggregateResultSchema } } },
    400: badFromMonth,
    502: upstream502,
  },
});

// --- gov-bond-yield-10y (snapshot) ---
const govBondYield10yResultSchema = z
  .object({
    yieldPct: nullableNumber,
    asOfMonth: z.string().nullable(),
    fieldStatuses: z.record(z.string(), z.object({ status: z.enum(["no_data", "not_applicable", "calculation_error"]), message: z.string() })),
    warnings: z.array(z.string()),
  })
  .openapi("GovBondYield10yResult", { example: { yieldPct: 1.9, asOfMonth: "2026-07", fieldStatuses: {}, warnings: [] } });

registry.registerPath({
  method: "get",
  path: "/macro/gov-bond-yield-10y",
  summary: "10 年期公債殖利率最新一筆（單點快照）",
  description:
    "資料來自 oingg-analysis-ts 既有的 GET /macro/gov-bond-yield-10y（2026-09-22 起在本服務代理）。只回最新一個月的值（yieldPct，百分比）跟其所屬月份（asOfMonth，\"YYYY-MM\"）；要整段序列請用 GET /macro/gov-bond-yield-10y-history。fieldStatuses 是 analysis-ts 標記個別欄位狀態的對照表，每個值是 { status, message } 物件（一切正常時是空物件；2026-10-07 之前 bff-ts 誤把每個值轉成字串「[object Object]」），warnings 是字串陣列，兩者都原樣轉發。",
  tags: ["Macro"],
  responses: {
    200: { description: "最新一筆 10 年期公債殖利率。", content: { "application/json": { schema: govBondYield10yResultSchema } } },
    502: upstream502,
  },
});

// --- gov-bond-yield-10y-history ---
const govBondYield10yHistoryEntrySchema = z.object({ ...monthlyPeriodFields, yieldPct: nullableNumber });

const govBondYield10yHistoryResultSchema = z
  .object({ entries: z.array(govBondYield10yHistoryEntrySchema) })
  .openapi("GovBondYield10yHistoryResult", {
    example: { entries: [{ period: "2026-06", year: 2026, month: 6, yieldPct: 1.77 }, { period: "2026-07", year: 2026, month: 7, yieldPct: 1.9 }] },
  });

registry.registerPath({
  method: "get",
  path: "/macro/gov-bond-yield-10y-history",
  summary: "10 年期公債殖利率月序列（全歷史）",
  description: `${SERIES_COMMON_NOTE}yieldPct 是百分比。全歷史約 369 筆。這是 GET /macro/gov-bond-yield-10y（只回最新一筆）的序列版，兩支並存。${FROM_MONTH_NOTE}`,
  tags: ["Macro"],
  request: { query: govBondYield10yHistoryQuerySchema.openapi("GovBondYield10yHistoryQuery", { example: { from: "2020-01" } }) },
  responses: {
    200: { description: "10 年期公債殖利率月序列。", content: { "application/json": { schema: govBondYield10yHistoryResultSchema } } },
    400: badFromMonth,
    502: upstream502,
  },
});

// --- stock-market-summary ---
const stockMarketSummaryEntrySchema = z.object({
  ...monthlyPeriodFields,
  listedCompanies: nullableNumber,
  totalParValue: nullableNumber,
  totalMarketValue: nullableNumber,
  totalTradingValue: nullableNumber,
  avgDailyTradingValue: nullableNumber,
  avgTaiex: nullableNumber,
  avgTaiexYoyPct: nullableNumber,
});

const stockMarketSummaryResultSchema = z
  .object({ entries: z.array(stockMarketSummaryEntrySchema) })
  .openapi("StockMarketSummaryResult", {
    example: {
      entries: [
        { period: "2026-07", year: 2026, month: 7, listedCompanies: 1083, totalParValue: 7910895, totalMarketValue: 140848179, totalTradingValue: 20732353, avgDailyTradingValue: 942380, avgTaiex: 44366.29, avgTaiexYoyPct: 93.208 },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/stock-market-summary",
  summary: "央行集中市場月摘要（上市家數、市值、成交值、加權指數月平均），月序列，1987-05 起",
  description: `${SERIES_COMMON_NOTE}來源是 gov-ts 的央行集中市場月摘要（2026-09-22 新增，給大事件年表頁把大盤線往前推到 1987 用——/market/taiex-daily-price 只到 1999）。金額欄位（totalParValue／totalMarketValue／totalTradingValue／avgDailyTradingValue）單位是新台幣百萬元。**avgTaiex 是該月的加權指數「平均」，不是月底收盤**——不能跟 GET /market/taiex-daily-price 的收盤序列接成同一條線；本服務原樣轉發，不做重取樣、不跟日線合併，前端若整條線改用這支請自行標示是月平均。avgTaiexYoyPct 是 avgTaiex 的年增率百分比。全歷史約 471 筆。${FROM_MONTH_NOTE}`,
  tags: ["Macro"],
  request: { query: stockMarketSummaryQuerySchema.openapi("StockMarketSummaryQuery", { example: { from: "1990-01" } }) },
  responses: {
    200: { description: "集中市場月摘要序列。", content: { "application/json": { schema: stockMarketSummaryResultSchema } } },
    400: badFromMonth,
    502: upstream502,
  },
});

// --- usd-twd-rate ---
const usdTwdRateEntrySchema = z.object({
  tradeDate: z.string(),
  bankBuyingRate: nullableNumber,
  bankSellingRate: nullableNumber,
  interbankClosingRate: nullableNumber,
});

const usdTwdRateResultSchema = z
  .object({ entries: z.array(usdTwdRateEntrySchema) })
  .openapi("UsdTwdRateResult", {
    example: {
      entries: [
        { tradeDate: "2026-06-30", bankBuyingRate: 31.8, bankSellingRate: 31.9, interbankClosingRate: 31.837 },
        { tradeDate: "2026-07-31", bankBuyingRate: 32.26, bankSellingRate: 32.36, interbankClosingRate: 32.292 },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/usd-twd-rate",
  summary: "美元兌新台幣匯率（銀行買入／賣出、銀行間收盤），日／週／月序列",
  description: `${SERIES_COMMON_NOTE}參數跟 GET /market/taiex-daily-price 完全同一套：limit 1~2000（預設 250，上游套用），interval 選填 daily／weekly／monthly（預設 daily；weekly／monthly 每區間取最後一個交易日那筆，tradeDate 仍是實際交易日，形狀不變）。兩者都只在有給時才往上游送，省略時回應跟上游預設逐 byte 相同。同樣是用粒度換深度：daily 在 2000 筆上限內只回到約 2018 年，monthly 約 415 筆可回到 1992 年全歷史——要跟大盤做長期對照請用 monthly。`,
  tags: ["Macro"],
  request: { query: usdTwdRateQuerySchema.openapi("UsdTwdRateQuery", { example: { limit: 2000, interval: "monthly" } }) },
  responses: {
    200: { description: "美元兌新台幣匯率序列（依 interval 取樣）。", content: { "application/json": { schema: usdTwdRateResultSchema } } },
    400: errorResponse("limit 不是 1~2000 之間的整數，或 interval 不是 daily／weekly／monthly。"),
    502: upstream502,
  },
});

// --- cpi ---
const cpiEntrySchema = z.object({ ...monthlyPeriodFields, indexValue: nullableNumber, yoyChangePct: nullableNumber });

const cpiResultSchema = z
  .object({ category: z.enum(CPI_CATEGORIES), entries: z.array(cpiEntrySchema) })
  .openapi("CpiResult", {
    example: {
      category: "total",
      entries: [{ period: "2026-07", year: 2026, month: 7, indexValue: 112.35, yoyChangePct: 2.54 }, { period: "2026-08", year: 2026, month: 8, indexValue: 112.32, yoyChangePct: 2.04 }],
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/cpi",
  summary: "主計總處消費者物價指數（CPI），依籃子分類，月序列",
  description: `${SERIES_COMMON_NOTE}一次查一個分類：category 選填，${CPI_CATEGORIES.join("／")}，預設 total（總指數）——回應頂層會回 category 標明實際套用的是哪一個。indexValue 是指數水準，yoyChangePct 是年增率百分比。${FROM_MONTH_NOTE}`,
  tags: ["Macro"],
  request: { query: cpiQuerySchema.openapi("CpiQuery", { example: { from: "2020-01", category: "food" } }) },
  responses: {
    200: { description: "指定分類的 CPI 月序列。", content: { "application/json": { schema: cpiResultSchema } } },
    400: errorResponse('from 不是 "YYYY-MM" 格式，或 category 不在允許清單內。'),
    502: upstream502,
  },
});

// --- gdp ---
const gdpEntrySchema = z.object({
  period: z.string(),
  year: z.number(),
  quarter: z.number(),
  contributionPoints: nullableNumber,
});

const gdpResultSchema = z
  .object({ category: z.enum(GDP_CATEGORIES), entries: z.array(gdpEntrySchema) })
  .openapi("GdpResult", {
    example: {
      category: "growth_rate",
      entries: [{ period: "2026-Q1", year: 2026, quarter: 1, contributionPoints: 15.43 }, { period: "2026-Q2", year: 2026, quarter: 2, contributionPoints: 12.93 }],
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/gdp",
  summary: "主計總處 GDP，依支出面組成項目，季序列",
  description: `${SERIES_COMMON_NOTE}一次查一個項目：category 選填，${GDP_CATEGORIES.join("／")}，預設 growth_rate——回應頂層會回 category 標明實際套用的是哪一個。contributionPoints 是該項目對經濟成長率的貢獻（百分點）——每筆只有這一個數值欄位（2026-09-22 稍早短暫有過 yoyChangePct，同日已由 analysis-ts 移除）。季序列每筆 period 是 "YYYY-Qn"，帶 year 跟 quarter。全歷史從 1981-Q1 起（約 182 筆）。from 選填，"YYYY-Qn"（例 2026-Q1），只回 period >= 該季的資料（含）；格式錯誤會 400（本服務先擋，不打上游）。`,
  tags: ["Macro"],
  request: { query: gdpQuerySchema.openapi("GdpQuery", { example: { from: "2020-Q1", category: "exports" } }) },
  responses: {
    200: { description: "指定項目的 GDP 季序列。", content: { "application/json": { schema: gdpResultSchema } } },
    400: errorResponse('from 不是 "YYYY-Qn" 格式，或 category 不在允許清單內。'),
    502: upstream502,
  },
});
