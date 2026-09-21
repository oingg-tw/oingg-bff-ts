import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import {
  businessCycleIndicatorQuerySchema,
  cbcPolicyRateQuerySchema,
  CPI_CATEGORIES,
  cpiQuerySchema,
  GDP_CATEGORIES,
  gdpQuerySchema,
  govBondYield10yHistoryQuerySchema,
  monetaryAggregateQuerySchema,
  usdTwdRateQuerySchema,
} from "@/domainBff/macro/macro.routes.js";

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
  m1aYoyPercent: nullableNumber,
  m1bAmount: nullableNumber,
  m1bYoyPercent: nullableNumber,
  m2Amount: nullableNumber,
  m2YoyPercent: nullableNumber,
});

const monetaryAggregateResultSchema = z
  .object({ entries: z.array(monetaryAggregateEntrySchema) })
  .openapi("MonetaryAggregateResult", {
    example: {
      entries: [
        { period: "2026-07", year: 2026, month: 7, m1aAmount: 12716291, m1aYoyPercent: 8.28, m1bAmount: 30530948, m1bYoyPercent: 7.34, m2Amount: 70224762, m2YoyPercent: 7.42 },
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
    fieldStatuses: z.record(z.string(), z.string()),
    warnings: z.array(z.string()),
  })
  .openapi("GovBondYield10yResult", { example: { yieldPct: 1.9, asOfMonth: "2026-07", fieldStatuses: {}, warnings: [] } });

registry.registerPath({
  method: "get",
  path: "/macro/gov-bond-yield-10y",
  summary: "10 年期公債殖利率最新一筆（單點快照）",
  description:
    "資料來自 oingg-analysis-ts 既有的 GET /macro/gov-bond-yield-10y（2026-09-22 起在本服務代理）。只回最新一個月的值（yieldPct，百分比）跟其所屬月份（asOfMonth，\"YYYY-MM\"）；要整段序列請用 GET /macro/gov-bond-yield-10y-history。fieldStatuses 是 analysis-ts 標記個別欄位狀態的字串對照表（一切正常時是空物件），warnings 是字串陣列，兩者都原樣轉發。",
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
const cpiEntrySchema = z.object({ ...monthlyPeriodFields, indexValue: nullableNumber, yoyChangePercent: nullableNumber });

const cpiResultSchema = z
  .object({ category: z.enum(CPI_CATEGORIES), entries: z.array(cpiEntrySchema) })
  .openapi("CpiResult", {
    example: {
      category: "total",
      entries: [{ period: "2026-07", year: 2026, month: 7, indexValue: 112.35, yoyChangePercent: 2.54 }, { period: "2026-08", year: 2026, month: 8, indexValue: 112.32, yoyChangePercent: 2.04 }],
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/cpi",
  summary: "主計總處消費者物價指數（CPI），依籃子分類，月序列",
  description: `${SERIES_COMMON_NOTE}一次查一個分類：category 選填，${CPI_CATEGORIES.join("／")}，預設 total（總指數）——回應頂層會回 category 標明實際套用的是哪一個。indexValue 是指數水準，yoyChangePercent 是年增率百分比。${FROM_MONTH_NOTE}`,
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
  description: `${SERIES_COMMON_NOTE}一次查一個項目：category 選填，${GDP_CATEGORIES.join("／")}，預設 growth_rate——回應頂層會回 category 標明實際套用的是哪一個。contributionPoints 是該項目對經濟成長率的貢獻（百分點）——每筆只有這一個數值欄位（2026-09-22 稍早短暫有過 yoyChangePercent，同日已由 analysis-ts 移除）。季序列每筆 period 是 "YYYY-Qn"，帶 year 跟 quarter。全歷史從 1981-Q1 起（約 182 筆）。from 選填，"YYYY-Qn"（例 2026-Q1），只回 period >= 該季的資料（含）；格式錯誤會 400（本服務先擋，不打上游）。`,
  tags: ["Macro"],
  request: { query: gdpQuerySchema.openapi("GdpQuery", { example: { from: "2020-Q1", category: "exports" } }) },
  responses: {
    200: { description: "指定項目的 GDP 季序列。", content: { "application/json": { schema: gdpResultSchema } } },
    400: errorResponse('from 不是 "YYYY-Qn" 格式，或 category 不在允許清單內。'),
    502: upstream502,
  },
});
