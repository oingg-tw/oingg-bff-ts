import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { getStockQuote } from "./stock.service.js";

export const stockRouter = Router();

/**
 * @swagger
 * /stocks/{symbol}:
 *   get:
 *     summary: 查詢股票的最新股價、本益比、本淨比、殖利率
 *     description: >
 *       **暫時無法使用**：直連 twse/tpex 已依「bff-ts 只能跟 analysis-ts 講話」的架構規則移除，
 *       analysis-ts 目前還沒有提供替代查詢 API（見 docs/直連DB反模式修復計畫.md），這是刻意接受的
 *       短期功能退化，不是 bug。目前這支端點一律回 503。
 *     tags:
 *       - Stock
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: 股票代號
 *         example: "2330"
 *     responses:
 *       200:
 *         description: 股價/估值資料，任一邊查無資料時對應欄位為 null。
 *       404:
 *         description: 上市、上櫃都查無此股票代號的任何資料。
 *       503:
 *         description: 功能暫時停用中，等待 analysis-ts 提供替代查詢 API。
 */
stockRouter.get("/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const quote = await getStockQuote(symbol);
  if (!quote) {
    throw new AppError(`No stock data found for symbol "${symbol}"`, 404);
  }
  res.json(quote);
});
