import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import { getStockQuote } from "@/domains/stock/stock.service.js";

export const stockRouter = Router();

/**
 * @swagger
 * /stocks/{symbol}:
 *   get:
 *     summary: 查詢股票的最新股價、本益比、本淨比、殖利率
 *     description: >
 *       資料來自 oingg-analysis-ts（不分上市/上櫃，由它內部判斷查哪個市場）。
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
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
stockRouter.get("/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const quote = await getStockQuote(symbol);
  if (!quote) {
    throw new AppError(`No stock data found for symbol "${symbol}"`, 404);
  }
  res.json(quote);
});
