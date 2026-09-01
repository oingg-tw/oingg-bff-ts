import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import {
  DEFAULT_MARGIN_SHORT_LIMIT,
  DEFAULT_TOP_PERCENT,
  getForeignHoldingRanking,
  getMarginShortRatioRanking,
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

/**
 * @swagger
 * /market/foreign-holding-ranking:
 *   get:
 *     summary: 外資持股比例加碼/減碼排行——比較最近兩個交易日的持股百分比變動
 *     description: >
 *       依「百分點變動」排序（不是張數變動，避免被增減資干擾），只涵蓋真正的上市公司
 *       （排除 ETF／衍生性商品）。topPercent 是「排序後取前幾 %」，不是固定筆數。
 *
 *       twse-ts 的外資持股資料如果還沒累積到兩個交易日可比較，increases/decreases 會是空陣列，
 *       warnings 會說明原因——這是資料還沒備齊，不是錯誤。
 *     tags:
 *       - Market
 *     parameters:
 *       - in: query
 *         name: topPercent
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 50
 *     responses:
 *       200:
 *         description: 加碼/減碼排行清單，附上比較的兩個交易日與 warnings。
 *         content:
 *           application/json:
 *             example:
 *               tradeDate: "2026-08-30"
 *               previousTradeDate: "2026-08-28"
 *               topPercent: 10
 *               eligibleCompanyCount: 1200
 *               increases:
 *                 - symbol: "2330"
 *                   sharesHeldPercent: "78.5"
 *                   previousSharesHeldPercent: "78.1"
 *                   changePercentagePoints: "0.4"
 *                   sharesHeld: "20500000000"
 *               decreases: []
 *               warnings: []
 *       400:
 *         description: topPercent 不是 1~50 之間的整數。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
marketRouter.get("/foreign-holding-ranking", async (req, res) => {
  const topPercent = parseIntQueryParam(req.query.topPercent, "topPercent", DEFAULT_TOP_PERCENT);
  const result = await getForeignHoldingRanking(topPercent);
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
