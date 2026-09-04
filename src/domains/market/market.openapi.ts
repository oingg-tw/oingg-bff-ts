import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";

const badRequest = (description: string) => errorResponse(description);
const upstream502 = errorResponse("analysis-ts 服務無法連線或回應格式異常。");
const nameField = z.string().nullable();
const marketField = z.enum(["TWSE", "TPEx"]);

function limitQuery(defaultValue: number, min: number, max: number) {
  return z.object({
    limit: z
      .coerce.number()
      .int()
      .optional()
      .openapi({ default: defaultValue, minimum: min, maximum: max }),
  });
}

// --- foreign-holding-ranking ---
const foreignHoldingEntrySchema = z.object({
  symbol: z.string(),
  name: nameField,
  sharesHeldPercent: z.string(),
  previousSharesHeldPercent: z.string(),
  changePercentagePoints: z.string(),
  sharesHeld: z.string(),
});
const foreignHoldingResultSchema = z
  .object({
    tradeDate: z.string().nullable(),
    previousTradeDate: z.string().nullable(),
    limit: z.number(),
    eligibleCompanyCount: z.number(),
    increases: z.array(foreignHoldingEntrySchema),
    decreases: z.array(foreignHoldingEntrySchema),
    warnings: z.array(z.string()),
  })
  .openapi("ForeignHoldingRankingResult", {
    example: {
      tradeDate: "2026-08-30",
      previousTradeDate: "2026-08-28",
      limit: 10,
      eligibleCompanyCount: 1200,
      increases: [
        {
          symbol: "2330",
          name: "台積電",
          sharesHeldPercent: "78.5",
          previousSharesHeldPercent: "78.1",
          changePercentagePoints: "0.4",
          sharesHeld: "20500000000",
        },
      ],
      decreases: [],
      warnings: [],
    },
  });

registry.registerPath({
  method: "get",
  path: "/market/foreign-holding-ranking",
  summary: "外資持股比例加碼/減碼排行——比較最近兩個交易日的持股百分比變動",
  description:
    "依「百分點變動」排序（不是張數變動，避免被增減資干擾），只涵蓋真正的上市公司（排除 ETF／衍生性商品）。limit 是「排序後取前幾筆」（各方向各自取，不是百分比）——2026-09-01 起 analysis-ts 把這個端點的參數從 topPercent（百分比）改成 limit（固定筆數），bff-ts 這邊同步跟進。twse-ts 的外資持股資料如果還沒累積到兩個交易日可比較，increases/decreases 會是空陣列，warnings 會說明原因——這是資料還沒備齊，不是錯誤。",
  tags: ["Market"],
  request: { query: limitQuery(10, 1, 20) },
  responses: {
    200: { description: "加碼/減碼排行清單，附上比較的兩個交易日與 warnings。", content: { "application/json": { schema: foreignHoldingResultSchema } } },
    400: badRequest("limit 不是 1~20 之間的整數。"),
    502: upstream502,
  },
});

// --- margin-short-ratio-ranking ---
const marginShortEntrySchema = z.object({
  rank: z.number(),
  symbol: z.string(),
  name: nameField,
  shortToMarginRatioPct: z.string(),
  marginTodayBalance: z.string(),
  shortTodayBalance: z.string(),
});
const marginShortResultSchema = z
  .object({
    tradeDate: z.string().nullable(),
    limit: z.number(),
    rankings: z.array(marginShortEntrySchema),
    warnings: z.array(z.string()),
  })
  .openapi("MarginShortRatioRankingResult", {
    example: {
      tradeDate: "2026-08-30",
      limit: 5,
      rankings: [{ rank: 1, symbol: "3045", name: "台灣光罩", shortToMarginRatioPct: "44.35", marginTodayBalance: "717", shortTodayBalance: "318" }],
      warnings: [],
    },
  });

registry.registerPath({
  method: "get",
  path: "/market/margin-short-ratio-ranking",
  summary: "券資比排行（融券今日餘額 ÷ 融資今日餘額 x 100）——籌碼面軋空熱度指標",
  description: "比值愈高愈可能軋空。融資餘額是 0 或查無融券資料的公司直接排除（不當 0 或無限大處理），只涵蓋真正的上市公司（排除 ETF／衍生性商品）。",
  tags: ["Market"],
  request: { query: limitQuery(20, 1, 100) },
  responses: {
    200: { description: "券資比排行清單。", content: { "application/json": { schema: marginShortResultSchema } } },
    400: badRequest("limit 不是 1~100 之間的整數。"),
    502: upstream502,
  },
});

// --- material-announcements ---
const materialAnnouncementEntrySchema = z.object({
  symbol: z.string(),
  name: nameField,
  announcementDate: z.string(),
  announcementTime: z.string(),
  reportDate: z.string(),
  subject: z.string(),
  clause: z.string(),
  factDate: z.string(),
  description: z.string(),
});
const materialAnnouncementsResultSchema = z
  .object({ limit: z.number(), items: z.array(materialAnnouncementEntrySchema), warnings: z.array(z.string()) })
  .openapi("MaterialAnnouncementsResult", {
    example: {
      limit: 3,
      items: [
        {
          symbol: "2072",
          name: "世紀風電",
          announcementDate: "2026-08-28",
          announcementTime: "70003",
          reportDate: "2026-08-29",
          subject: "公告本公司名稱由「世紀離岸風電設備股份有限公司」更名為「世紀能源設備股份有限公司」",
          clause: "第51款",
          factDate: "2026-08-24",
          description: "1.事實發生日：民國115年08月24日...",
        },
      ],
      warnings: [],
    },
  });

registry.registerPath({
  method: "get",
  path: "/market/material-announcements",
  summary: "上市公司重大訊息公告——依公告日期新到舊",
  description: "announcementTime 是 twse-ts 原始的 HHMMSS 數字字串（未補零，例如 \"70003\"），照原樣傳遞不重新格式化。",
  tags: ["Market"],
  request: { query: limitQuery(20, 1, 50) },
  responses: {
    200: { description: "重大訊息公告清單。", content: { "application/json": { schema: materialAnnouncementsResultSchema } } },
    400: badRequest("limit 不是 1~50 之間的整數。"),
    502: upstream502,
  },
});

// --- revenue-ranking ---
const revenueRankingEntrySchema = z.object({
  rank: z.number(),
  symbol: z.string(),
  name: nameField,
  market: marketField,
  currentMonthRevenue: z.string(),
  momChangePercent: z.string().nullable(),
  yoyChangePercent: z.string().nullable(),
});
const revenueRankingResultSchema = z
  .object({
    yearMonth: z.string(),
    metric: z.enum(["yoy", "mom", "revenue"]),
    order: z.enum(["asc", "desc"]),
    limit: z.number(),
    rankings: z.array(revenueRankingEntrySchema),
    warnings: z.array(z.string()),
  })
  .openapi("RevenueRankingResult", {
    example: {
      yearMonth: "2026-07",
      metric: "yoy",
      order: "desc",
      limit: 2,
      rankings: [{ rank: 1, symbol: "4113", name: "聯上", market: "TPEx", currentMonthRevenue: "581140", momChangePercent: "250.1181", yoyChangePercent: "1096390.566" }],
      warnings: [],
    },
  });

registry.registerPath({
  method: "get",
  path: "/market/revenue-ranking",
  summary: "月營收排行——依 metric 指定排序依據（YoY／MoM／營收金額）",
  description: "上市＋上櫃合併（2026-09-01 起）。metric/order 都是必填，沒有預設值。momChangePercent/yoyChangePercent 沒有可比較的前期資料時是 null，不是查詢失敗。",
  tags: ["Market"],
  request: {
    query: z.object({
      metric: z.enum(["yoy", "mom", "revenue"]),
      order: z.enum(["asc", "desc"]),
      limit: z.coerce.number().int().optional().openapi({ default: 20, minimum: 1, maximum: 50 }),
    }),
  },
  responses: {
    200: { description: "月營收排行清單。", content: { "application/json": { schema: revenueRankingResultSchema } } },
    400: badRequest("metric/order 缺漏或不是允許的值，或 limit 不是 1~50 之間的整數。"),
    502: upstream502,
  },
});

// --- volume-top20 ---
const volumeTop20EntrySchema = z.object({
  rank: z.number(),
  symbol: z.string(),
  name: nameField,
  market: marketField,
  volume: z.string(),
  transaction: z.string().nullable(),
  open: z.string().nullable(),
  high: z.string().nullable(),
  low: z.string().nullable(),
  close: z.string().nullable(),
  dir: z.string().nullable(),
  change: z.string().nullable(),
  changePercent: z.string().nullable(),
});
const volumeTop20ResultSchema = z
  .object({ tradeDate: z.string().nullable(), rankings: z.array(volumeTop20EntrySchema) })
  .openapi("VolumeTop20Result", {
    example: {
      tradeDate: "2026-09-01",
      rankings: [
        { rank: 1, symbol: "6182", name: "合晶", market: "TPEx", volume: "72836", transaction: null, open: null, high: null, low: null, close: null, dir: null, change: null, changePercent: "-4.09" },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/market/volume-top20",
  summary: "成交量前20——上市＋上櫃合併，無查詢參數",
  description:
    "刻意不排除 ETF／衍生性商品，跟本服務其他排行端點不同。TPEx 目前沒有 transaction/open/high/low/close/dir/change 這幾個欄位，會是 null（不是查詢失敗）。changePercent 是單日點對點漲跌幅，analysis-ts 自己用 daily_price 算的（不是來源的 dir/change 欄位），確保上市/上櫃算法一致，資料不足時是 null。",
  tags: ["Market"],
  responses: {
    200: { description: "成交量前20清單。", content: { "application/json": { schema: volumeTop20ResultSchema } } },
    502: upstream502,
  },
});

// --- disposed-stocks ---
const disposedStockEntrySchema = z.object({
  symbol: z.string(),
  name: nameField,
  market: marketField,
  announceDate: z.string(),
  announcementCount: z.number().nullable(),
  reason: z.string(),
  reasonTimes: z.number().nullable(),
  reasonShort: z.string().nullable(),
  dispositionPeriod: z.string(),
  dispositionStartDate: z.string(),
  dispositionEndDate: z.string(),
  dispositionMeasures: z.string().nullable(),
  detail: z.string(),
  linkInformation: z.string().nullable(),
  sixDayChangePercent: z.string().nullable(),
});
const disposedStocksResultSchema = z
  .object({ limit: z.number(), items: z.array(disposedStockEntrySchema), warnings: z.array(z.string()) })
  .openapi("DisposedStocksResult", {
    example: {
      limit: 1,
      items: [
        {
          symbol: "3629",
          name: "地心引力",
          market: "TPEx",
          announceDate: "2026-09-01",
          announcementCount: null,
          reason: "因連續3個營業日達本中心作業要點第四條第一項第一款",
          reasonTimes: 3,
          reasonShort: "漲跌異常",
          dispositionPeriod: "1150902~1150908",
          dispositionStartDate: "2026-09-02",
          dispositionEndDate: "2026-09-08",
          dispositionMeasures: null,
          detail: "...",
          linkInformation: null,
          sixDayChangePercent: "42.65",
        },
      ],
      warnings: [],
    },
  });

registry.registerPath({
  method: "get",
  path: "/market/disposed-stocks",
  summary: "處置股清單——依公告日期新到舊，上市＋上櫃合併",
  description:
    "只涵蓋真正的上市/上櫃公司（已比對 company_profile 排除非公司標的）。TPEx 目前沒有 announcementCount/dispositionMeasures/linkInformation 這幾個欄位，會是 null（不是查詢失敗）。reasonTimes 是從 reason 解析出的次數（例如「連續五次」→5），reasonShort 是從 reason 解析出的中文短標籤，部分處置原因本身沒有次數/款次概念時兩者都是 null，不是解析失敗——⚠️ reasonShort 的 TPEx 端款次編號是比對 TWSE 規則名稱推斷的，未來可能修正。dispositionStartDate/dispositionEndDate 是把 dispositionPeriod 拆成的兩個西元日期欄位，dispositionPeriod 原始字串仍保留。sixDayChangePercent 是以 announceDate 為基準日往前推 6 個交易日的累積漲跌幅，資料不足 6 個交易日時是 null。",
  tags: ["Market"],
  request: { query: limitQuery(20, 1, 50) },
  responses: {
    200: { description: "處置股清單。", content: { "application/json": { schema: disposedStocksResultSchema } } },
    400: badRequest("limit 不是 1~50 之間的整數。"),
    502: upstream502,
  },
});

// --- attention-stocks ---
const attentionStockCriteriaDetailSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  observationDays: z.number().nullable(),
  times: z.number(),
});
const attentionStockEntrySchema = z.object({
  symbol: z.string(),
  name: nameField,
  market: marketField,
  tradeDate: z.string(),
  criteria: z.string(),
  criteriaDetails: z.array(attentionStockCriteriaDetailSchema),
  sixDayChangePercent: z.string().nullable(),
});
const attentionStocksResultSchema = z
  .object({ limit: z.number(), items: z.array(attentionStockEntrySchema), warnings: z.array(z.string()) })
  .openapi("AttentionStocksResult", {
    example: {
      limit: 1,
      items: [
        {
          symbol: "3406",
          name: "玉晶光",
          market: "TWSE",
          tradeDate: "2026-09-01",
          criteria: "115年8月28日至115年8月31日連續二次",
          criteriaDetails: [{ startDate: "2026-08-28", endDate: "2026-08-31", observationDays: null, times: 2 }],
          sixDayChangePercent: "41.08",
        },
      ],
      warnings: [],
    },
  });

registry.registerPath({
  method: "get",
  path: "/market/attention-stocks",
  summary: "注意股清單——依交易日新到舊，上市＋上櫃合併",
  description:
    "只涵蓋真正的上市/上櫃公司（已比對 company_profile 排除非公司標的）。criteriaDetails 是 analysis-ts 把 criteria 中文說明解析成的結構化資料（陣列，因為原始文字有時會串接兩個子句）。observationDays 只有「N個營業日內已有M次」格式才有值，解析失敗時是空陣列，criteria 原始文字不受影響。sixDayChangePercent 是以 tradeDate 為基準日往前推 6 個交易日的累積漲跌幅，資料不足 6 個交易日時是 null。",
  tags: ["Market"],
  request: { query: limitQuery(20, 1, 50) },
  responses: {
    200: { description: "注意股清單。", content: { "application/json": { schema: attentionStocksResultSchema } } },
    400: badRequest("limit 不是 1~50 之間的整數。"),
    502: upstream502,
  },
});

// --- price-limit-range ---
const priceLimitRangeEntrySchema = z.object({
  rank: z.number(),
  symbol: z.string(),
  name: nameField,
  market: marketField,
  limitUp: z.string(),
  limitDown: z.string(),
  limitRange: z.string(),
  openingRefPrice: z.string().nullable(),
  previousDayPrice: z.string().nullable(),
  allowOddLotTrade: z.string().nullable(),
});
const priceLimitRangeResultSchema = z
  .object({
    tradeDate: z.string().nullable(),
    widest: z.array(priceLimitRangeEntrySchema),
    narrowest: z.array(priceLimitRangeEntrySchema),
  })
  .openapi("PriceLimitRangeResult", {
    example: {
      tradeDate: "2026-09-01",
      widest: [{ rank: 1, symbol: "5274", name: "信驊", market: "TPEx", limitUp: "18830", limitDown: "15410", limitRange: "3420", openingRefPrice: null, previousDayPrice: null, allowOddLotTrade: null }],
      narrowest: [],
    },
  });

registry.registerPath({
  method: "get",
  path: "/market/price-limit-range",
  summary: "漲跌停幅度最大/最小各20檔——上市＋上櫃合併，無查詢參數",
  description: "TPEx 目前沒有 openingRefPrice/previousDayPrice/allowOddLotTrade 這幾個欄位，會是 null（不是查詢失敗）。",
  tags: ["Market"],
  responses: {
    200: { description: "widest/narrowest 兩組清單，各最多20檔。", content: { "application/json": { schema: priceLimitRangeResultSchema } } },
    502: upstream502,
  },
});

// --- price-change-ranking ---
const priceChangeRankingEntrySchema = z.object({
  rank: z.number(),
  symbol: z.string(),
  name: nameField,
  market: marketField,
  tradeDate: z.string(),
  previousTradeDate: z.string(),
  close: z.string(),
  previousClose: z.string(),
  changeAmount: z.string(),
  changePercent: z.string(),
});
const priceChangeRankingResultSchema = z
  .object({
    limit: z.number(),
    gainers: z.array(priceChangeRankingEntrySchema),
    losers: z.array(priceChangeRankingEntrySchema),
    warnings: z.array(z.string()),
  })
  .openapi("PriceChangeRankingResult", {
    example: {
      limit: 1,
      gainers: [{ rank: 1, symbol: "2492", name: "華新科", market: "TWSE", tradeDate: "2026-08-28", previousTradeDate: "2026-08-27", close: "313.5", previousClose: "285", changeAmount: "28.5", changePercent: "10" }],
      losers: [],
      warnings: [],
    },
  });

registry.registerPath({
  method: "get",
  path: "/market/price-change-ranking",
  summary: "漲跌幅排行——上市＋上櫃合併，各自取自己最新兩個交易日",
  description:
    "跟 foreign-holding-ranking 一樣是「兩個方向一起回」的形狀（gainers/losers）。上市跟上櫃各自用自己最新的兩個交易日算，不強迫用同一天，所以 tradeDate/previousTradeDate 是每一列自己帶，不是頂層共用欄位。已排除 ETF／衍生性商品。資料來自 daily_price（本來就有完整市場鏡像），不受 twse-ts/tpex-ts 專屬 export dataset 的部署進度影響。",
  tags: ["Market"],
  request: { query: limitQuery(20, 1, 50) },
  responses: {
    200: { description: "gainers/losers 兩組清單，各最多 limit 檔。", content: { "application/json": { schema: priceChangeRankingResultSchema } } },
    400: badRequest("limit 不是 1~50 之間的整數。"),
    502: upstream502,
  },
});

// --- etf-ranking ---
const etfRankingMetricEnum = z.enum([
  "aum", "holders", "netFlow", "dcaAmount", "return3m", "return6m", "return1y", "return2y", "return3y", "return5y", "returnYtd", "return10y", "expenseRatio",
]);
const etfRankingEntrySchema = z.object({
  rank: z.number(),
  symbol: z.string(),
  fundName: z.string(),
  shortName: z.string(),
  issuerName: z.string().nullable(),
  category: z.string(),
  market: marketField,
  assetClass: z.enum(["國內成分證券", "國外成分證券", "債券成分", "槓桿型", "反向型", "多資產", "連結式"]).nullable(),
  isActive: z.boolean(),
  distributionFrequency: z.enum(["月配", "季配", "半年配", "年配", "一年兩次配息", "其他", "不分配"]).nullable(),
  value: z.string(),
  asOf: z.string(),
});
const etfRankingResultSchema = z
  .object({
    metric: etfRankingMetricEnum,
    order: z.enum(["asc", "desc"]),
    limit: z.number(),
    rankings: z.array(etfRankingEntrySchema),
    warnings: z.array(z.string()),
  })
  .openapi("EtfRankingResult", {
    example: {
      metric: "aum",
      order: "desc",
      limit: 1,
      rankings: [
        { rank: 1, symbol: "0050", fundName: "元大台灣卓越50基金", shortName: "元大台灣50", issuerName: "元大投信", category: "上市ETF_國內成分證券ETF", market: "TWSE", assetClass: "國內成分證券", isActive: false, distributionFrequency: "半年配", value: "2283731446214", asOf: "2026-07" },
      ],
      warnings: [],
    },
  });

registry.registerPath({
  method: "get",
  path: "/market/etf-ranking",
  summary: "ETF 排行——第一支消費 sitca-ts 資料的端點",
  description:
    "metric/order 都是必填，沒有預設值。aum/holders/netFlow/dcaAmount 是 sitca-ts 最新一個月快照（asOf 是 \"YYYY-MM\"）；return3m~return10y 是各天期累積報酬率（不是年化）；expenseRatio 只用最新一個完整年度（asOf 是 \"YYYY\"），發行日落在該基準年（或更晚）的 ETF 會被排除，避免混進不同基準年的資料。這支不排除任何 ETF 類型（槓桿/反向 ETF 也會出現）。market/assetClass/isActive 是從 category（原始字串保留）解析出來的。distributionFrequency 是配息頻率，查無資料時是 null。",
  tags: ["Market"],
  request: {
    query: z.object({
      metric: etfRankingMetricEnum,
      order: z.enum(["asc", "desc"]),
      limit: z.coerce.number().int().optional().openapi({ default: 20, minimum: 1, maximum: 50 }),
    }),
  },
  responses: {
    200: { description: "ETF 排行清單。", content: { "application/json": { schema: etfRankingResultSchema } } },
    400: badRequest("metric/order 缺漏或不是允許的值，或 limit 不是 1~50 之間的整數。"),
    502: upstream502,
  },
});
