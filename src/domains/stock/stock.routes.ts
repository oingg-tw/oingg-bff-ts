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
 *       同時查 twse、tpex 兩個 Neon DB（上市/上櫃代號不重疊，哪邊有資料就回哪邊）。
 *       股價跟估值分開查最新一筆，不強制同一天——兩者缺值模式不同。
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
 */
stockRouter.get("/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const quote = await getStockQuote(symbol);
  if (!quote) {
    throw new AppError(`No stock data found for symbol "${symbol}"`, 404);
  }
  res.json(quote);
});
