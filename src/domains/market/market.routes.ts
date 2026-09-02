import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import {
  DEFAULT_ATTENTION_STOCKS_LIMIT,
  DEFAULT_DISPOSED_STOCKS_LIMIT,
  DEFAULT_ETF_RANKING_LIMIT,
  DEFAULT_FOREIGN_HOLDING_LIMIT,
  DEFAULT_MARGIN_SHORT_LIMIT,
  DEFAULT_MATERIAL_ANNOUNCEMENTS_LIMIT,
  DEFAULT_PRICE_CHANGE_RANKING_LIMIT,
  DEFAULT_REVENUE_RANKING_LIMIT,
  getAttentionStocks,
  getDisposedStocks,
  getEtfRanking,
  getForeignHoldingRanking,
  getMarginShortRatioRanking,
  getMaterialAnnouncements,
  getPriceChangeRanking,
  getPriceLimitRange,
  getRevenueRanking,
  getVolumeTop20,
} from "@/domains/market/market.service.js";

export const marketRouter = Router();

function parseIntQueryParam(raw: unknown, name: string, defaultValue: number): number {
  if (raw === undefined) {
    return defaultValue;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value)) {
    throw new AppError(`"${name}" must be an integer`, 400);
  }
  return value;
}

/** analysis-ts requires this param with no default — fail fast with the same message shape as an unknown/bad value. */
function requireStringQueryParam(raw: unknown, name: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new AppError(`"${name}" is required`, 400);
  }
  return raw;
}

/**
 * @swagger
 * /market/foreign-holding-ranking:
 *   get:
 *     summary: 外資持股比例加碼/減碼排行——比較最近兩個交易日的持股百分比變動
 *     description: >
 *       依「百分點變動」排序（不是張數變動，避免被增減資干擾），只涵蓋真正的上市公司
 *       （排除 ETF／衍生性商品）。limit 是「排序後取前幾筆」（各方向各自取，不是百分比）——
 *       2026-09-01 起 analysis-ts 把這個端點的參數從 topPercent（百分比）改成 limit（固定筆數），
 *       bff-ts 這邊同步跟進。
 *
 *       twse-ts 的外資持股資料如果還沒累積到兩個交易日可比較，increases/decreases 會是空陣列，
 *       warnings 會說明原因——這是資料還沒備齊，不是錯誤。
 *     tags:
 *       - Market
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 20
 *     responses:
 *       200:
 *         description: 加碼/減碼排行清單，附上比較的兩個交易日與 warnings。
 *         content:
 *           application/json:
 *             example:
 *               tradeDate: "2026-08-30"
 *               previousTradeDate: "2026-08-28"
 *               limit: 10
 *               eligibleCompanyCount: 1200
 *               increases:
 *                 - symbol: "2330"
 *                   name: "台積電"
 *                   sharesHeldPercent: "78.5"
 *                   previousSharesHeldPercent: "78.1"
 *                   changePercentagePoints: "0.4"
 *                   sharesHeld: "20500000000"
 *               decreases: []
 *               warnings: []
 *       400:
 *         description: limit 不是 1~20 之間的整數。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
marketRouter.get("/foreign-holding-ranking", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_FOREIGN_HOLDING_LIMIT);
  const result = await getForeignHoldingRanking(limit);
  res.json(result);
});

/**
 * @swagger
 * /market/margin-short-ratio-ranking:
 *   get:
 *     summary: 券資比排行（融券今日餘額 ÷ 融資今日餘額 x 100）——籌碼面軋空熱度指標
 *     description: >
 *       比值愈高愈可能軋空。融資餘額是 0 或查無融券資料的公司直接排除（不當 0 或無限大處理），
 *       只涵蓋真正的上市公司（排除 ETF／衍生性商品）。
 *     tags:
 *       - Market
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 100
 *     responses:
 *       200:
 *         description: 券資比排行清單。
 *         content:
 *           application/json:
 *             example:
 *               tradeDate: "2026-08-30"
 *               limit: 5
 *               rankings:
 *                 - rank: 1
 *                   symbol: "3045"
 *                   name: "台灣光罩"
 *                   shortToMarginRatioPct: "44.35"
 *                   marginTodayBalance: "717"
 *                   shortTodayBalance: "318"
 *               warnings: []
 *       400:
 *         description: limit 不是 1~100 之間的整數。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
marketRouter.get("/margin-short-ratio-ranking", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_MARGIN_SHORT_LIMIT);
  const result = await getMarginShortRatioRanking(limit);
  res.json(result);
});

/**
 * @swagger
 * /market/material-announcements:
 *   get:
 *     summary: 上市公司重大訊息公告——依公告日期新到舊
 *     description: >
 *       announcementTime 是 twse-ts 原始的 HHMMSS 數字字串（未補零，例如 "70003"），照原樣傳遞不重新格式化。
 *     tags:
 *       - Market
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 50
 *     responses:
 *       200:
 *         description: 重大訊息公告清單。
 *         content:
 *           application/json:
 *             example:
 *               limit: 3
 *               items:
 *                 - symbol: "2072"
 *                   name: "世紀風電"
 *                   announcementDate: "2026-08-28"
 *                   announcementTime: "70003"
 *                   reportDate: "2026-08-29"
 *                   subject: "公告本公司名稱由「世紀離岸風電設備股份有限公司」更名為「世紀能源設備股份有限公司」"
 *                   clause: "第51款"
 *                   factDate: "2026-08-24"
 *                   description: "1.事實發生日：民國115年08月24日..."
 *               warnings: []
 *       400:
 *         description: limit 不是 1~50 之間的整數。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
marketRouter.get("/material-announcements", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_MATERIAL_ANNOUNCEMENTS_LIMIT);
  const result = await getMaterialAnnouncements(limit);
  res.json(result);
});

/**
 * @swagger
 * /market/revenue-ranking:
 *   get:
 *     summary: 月營收排行——依 metric 指定排序依據（YoY／MoM／營收金額）
 *     description: >
 *       上市＋上櫃合併（2026-09-01 起）。metric/order 都是必填，沒有預設值。momChangePercent/
 *       yoyChangePercent 沒有可比較的前期資料時是 null，不是查詢失敗。
 *     tags:
 *       - Market
 *     parameters:
 *       - in: query
 *         name: metric
 *         required: true
 *         schema:
 *           type: string
 *           enum: [yoy, mom, revenue]
 *       - in: query
 *         name: order
 *         required: true
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 50
 *     responses:
 *       200:
 *         description: 月營收排行清單。
 *         content:
 *           application/json:
 *             example:
 *               yearMonth: "2026-07"
 *               metric: "yoy"
 *               order: "desc"
 *               limit: 2
 *               rankings:
 *                 - rank: 1
 *                   symbol: "4113"
 *                   name: "聯上"
 *                   market: "TPEx"
 *                   currentMonthRevenue: "581140"
 *                   momChangePercent: "250.1181"
 *                   yoyChangePercent: "1096390.566"
 *               warnings: []
 *       400:
 *         description: metric/order 缺漏或不是允許的值，或 limit 不是 1~50 之間的整數。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
marketRouter.get("/revenue-ranking", async (req, res) => {
  const metric = requireStringQueryParam(req.query.metric, "metric");
  const order = requireStringQueryParam(req.query.order, "order");
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_REVENUE_RANKING_LIMIT);
  const result = await getRevenueRanking(metric, order, limit);
  res.json(result);
});

/**
 * @swagger
 * /market/volume-top20:
 *   get:
 *     summary: 成交量前20——上市＋上櫃合併，無查詢參數
 *     description: >
 *       刻意不排除 ETF／衍生性商品，跟本服務其他排行端點不同。TPEx 目前沒有 transaction/open/high/
 *       low/close/dir/change 這幾個欄位，會是 null（不是查詢失敗）。changePercent 是單日點對點漲跌幅，
 *       analysis-ts 自己用 daily_price 算的（不是來源的 dir/change 欄位），確保上市/上櫃算法一致，資料
 *       不足時是 null。
 *     tags:
 *       - Market
 *     responses:
 *       200:
 *         description: 成交量前20清單。
 *         content:
 *           application/json:
 *             example:
 *               tradeDate: "2026-09-01"
 *               rankings:
 *                 - rank: 1
 *                   symbol: "6182"
 *                   name: "合晶"
 *                   market: "TPEx"
 *                   volume: "72836"
 *                   transaction: null
 *                   open: null
 *                   high: null
 *                   low: null
 *                   close: null
 *                   dir: null
 *                   change: null
 *                   changePercent: "-4.09"
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
marketRouter.get("/volume-top20", async (_req, res) => {
  const result = await getVolumeTop20();
  res.json(result);
});

/**
 * @swagger
 * /market/disposed-stocks:
 *   get:
 *     summary: 處置股清單——依公告日期新到舊，上市＋上櫃合併
 *     description: >
 *       只涵蓋真正的上市/上櫃公司（已比對 company_profile 排除非公司標的）。TPEx 目前沒有
 *       announcementCount/dispositionMeasures/linkInformation 這幾個欄位，會是 null（不是查詢失敗）。
 *       reasonTimes 是從 reason 解析出的次數（例如「連續五次」→5），reasonShort 是從 reason 解析出的
 *       中文短標籤（對照官方注意/處置作業要點第四條第一款~第十三款），部分處置原因本身沒有次數/款次概念
 *       （例如可轉債標的證券）時兩者都是 null，不是解析失敗——⚠️ reasonShort 的 TPEx 端款次編號是比對
 *       TWSE 規則名稱推斷的，TPEx 官方頁面目前拿不到逐字確認，未來可能修正。dispositionStartDate/
 *       dispositionEndDate 是把 dispositionPeriod 拆成的兩個西元日期欄位，dispositionPeriod 原始字串
 *       仍保留。sixDayChangePercent 是以 announceDate 為基準日，往前推 6 個交易日的累積漲跌幅（點對點，
 *       非逐日相加），資料不足 6 個交易日時是 null。
 *     tags:
 *       - Market
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 50
 *     responses:
 *       200:
 *         description: 處置股清單。
 *         content:
 *           application/json:
 *             example:
 *               limit: 1
 *               items:
 *                 - symbol: "3629"
 *                   name: "地心引力"
 *                   market: "TPEx"
 *                   announceDate: "2026-09-01"
 *                   announcementCount: null
 *                   reason: "因連續3個營業日達本中心作業要點第四條第一項第一款"
 *                   reasonTimes: 3
 *                   reasonShort: "漲跌異常"
 *                   dispositionPeriod: "1150902~1150908"
 *                   dispositionStartDate: "2026-09-02"
 *                   dispositionEndDate: "2026-09-08"
 *                   dispositionMeasures: null
 *                   detail: "..."
 *                   linkInformation: null
 *                   sixDayChangePercent: "42.65"
 *               warnings: []
 *       400:
 *         description: limit 不是 1~50 之間的整數。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
marketRouter.get("/disposed-stocks", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_DISPOSED_STOCKS_LIMIT);
  const result = await getDisposedStocks(limit);
  res.json(result);
});

/**
 * @swagger
 * /market/attention-stocks:
 *   get:
 *     summary: 注意股清單——依交易日新到舊，上市＋上櫃合併
 *     description: >
 *       只涵蓋真正的上市/上櫃公司（已比對 company_profile 排除非公司標的）。criteriaDetails 是
 *       analysis-ts 把 criteria 中文說明解析成的結構化資料（陣列，因為原始文字有時會串接兩個子句）。
 *       observationDays 只有「N個營業日內已有M次」格式才有值，解析失敗時是空陣列，criteria 原始文字不受
 *       影響。sixDayChangePercent 是以 tradeDate 為基準日，往前推 6 個交易日的累積漲跌幅（點對點，非逐日
 *       相加），資料不足 6 個交易日時是 null。
 *     tags:
 *       - Market
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 50
 *     responses:
 *       200:
 *         description: 注意股清單。
 *         content:
 *           application/json:
 *             example:
 *               limit: 1
 *               items:
 *                 - symbol: "3406"
 *                   name: "玉晶光"
 *                   market: "TWSE"
 *                   tradeDate: "2026-09-01"
 *                   criteria: "115年8月28日至115年8月31日連續二次"
 *                   criteriaDetails:
 *                     - startDate: "2026-08-28"
 *                       endDate: "2026-08-31"
 *                       observationDays: null
 *                       times: 2
 *                   sixDayChangePercent: "41.08"
 *               warnings: []
 *       400:
 *         description: limit 不是 1~50 之間的整數。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
marketRouter.get("/attention-stocks", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_ATTENTION_STOCKS_LIMIT);
  const result = await getAttentionStocks(limit);
  res.json(result);
});

/**
 * @swagger
 * /market/price-limit-range:
 *   get:
 *     summary: 漲跌停幅度最大/最小各20檔——上市＋上櫃合併，無查詢參數
 *     description: >
 *       TPEx 目前沒有 openingRefPrice/previousDayPrice/allowOddLotTrade 這幾個欄位，會是 null
 *       （不是查詢失敗）。
 *     tags:
 *       - Market
 *     responses:
 *       200:
 *         description: widest/narrowest 兩組清單，各最多20檔。
 *         content:
 *           application/json:
 *             example:
 *               tradeDate: "2026-09-01"
 *               widest:
 *                 - rank: 1
 *                   symbol: "5274"
 *                   name: "信驊"
 *                   market: "TPEx"
 *                   limitUp: "18830"
 *                   limitDown: "15410"
 *                   limitRange: "3420"
 *                   openingRefPrice: null
 *                   previousDayPrice: null
 *                   allowOddLotTrade: null
 *               narrowest: []
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
marketRouter.get("/price-limit-range", async (_req, res) => {
  const result = await getPriceLimitRange();
  res.json(result);
});

/**
 * @swagger
 * /market/price-change-ranking:
 *   get:
 *     summary: 漲跌幅排行——上市＋上櫃合併，各自取自己最新兩個交易日
 *     description: >
 *       跟 foreign-holding-ranking 一樣是「兩個方向一起回」的形狀（gainers/losers）。上市跟上櫃各自用
 *       自己最新的兩個交易日算，不強迫用同一天，所以 tradeDate/previousTradeDate 是每一列自己帶，不是
 *       頂層共用欄位。已排除 ETF／衍生性商品。資料來自 daily_price（本來就有完整市場鏡像），不受
 *       twse-ts/tpex-ts 專屬 export dataset 的部署進度影響。
 *     tags:
 *       - Market
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 50
 *     responses:
 *       200:
 *         description: gainers/losers 兩組清單，各最多 limit 檔。
 *         content:
 *           application/json:
 *             example:
 *               limit: 1
 *               gainers:
 *                 - rank: 1
 *                   symbol: "2492"
 *                   name: "華新科"
 *                   market: "TWSE"
 *                   tradeDate: "2026-08-28"
 *                   previousTradeDate: "2026-08-27"
 *                   close: "313.5"
 *                   previousClose: "285"
 *                   changeAmount: "28.5"
 *                   changePercent: "10"
 *               losers: []
 *               warnings: []
 *       400:
 *         description: limit 不是 1~50 之間的整數。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
marketRouter.get("/price-change-ranking", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_PRICE_CHANGE_RANKING_LIMIT);
  const result = await getPriceChangeRanking(limit);
  res.json(result);
});

/**
 * @swagger
 * /market/etf-ranking:
 *   get:
 *     summary: ETF 排行——第一支消費 sitca-ts 資料的端點
 *     description: >
 *       metric/order 都是必填，沒有預設值。aum/holders/netFlow/dcaAmount 是 sitca-ts 最新一個月快照
 *       （asOf 是 "YYYY-MM"）；return3m~return10y 是各天期累積報酬率（不是年化）；expenseRatio 只用
 *       最新一個完整年度（asOf 是 "YYYY"），發行日落在該基準年（或更晚）的 ETF 會被排除，避免混進不同
 *       基準年的資料。這支不排除任何 ETF 類型（槓桿/反向 ETF 也會出現）——跟股票排行端點的 ETF 排除邏輯
 *       相反，因為這支本來就是 ETF 排行。
 *     tags:
 *       - Market
 *     parameters:
 *       - in: query
 *         name: metric
 *         required: true
 *         schema:
 *           type: string
 *           enum: [aum, holders, netFlow, dcaAmount, return3m, return6m, return1y, return2y, return3y, return5y, returnYtd, return10y, expenseRatio]
 *       - in: query
 *         name: order
 *         required: true
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 50
 *     responses:
 *       200:
 *         description: ETF 排行清單。
 *         content:
 *           application/json:
 *             example:
 *               metric: "aum"
 *               order: "desc"
 *               limit: 1
 *               rankings:
 *                 - rank: 1
 *                   symbol: "0050"
 *                   fundName: "元大台灣卓越50基金"
 *                   shortName: "元大台灣50"
 *                   issuerName: "元大投信"
 *                   category: "上市ETF_國內成分證券ETF"
 *                   value: "2283731446214"
 *                   asOf: "2026-07"
 *               warnings: []
 *       400:
 *         description: metric/order 缺漏或不是允許的值，或 limit 不是 1~50 之間的整數。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
marketRouter.get("/etf-ranking", async (req, res) => {
  const metric = requireStringQueryParam(req.query.metric, "metric");
  const order = requireStringQueryParam(req.query.order, "order");
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_ETF_RANKING_LIMIT);
  const result = await getEtfRanking(metric, order, limit);
  res.json(result);
});
