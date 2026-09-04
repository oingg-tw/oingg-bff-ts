import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import { getCapitalStockHistory, getCompanyProfile, getStockQuote } from "@/domains/stock/stock.service.js";

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

/**
 * @swagger
 * /stocks/{symbol}/profile:
 *   get:
 *     summary: 查詢公司基本資料（董事長、發言人、實收資本額、簽證會計師等）
 *     description: >
 *       資料來自 oingg-analysis-ts 的 GET /companies/profile（上市查無資料才查上櫃）。不篩選 ETF／KY／
 *       興櫃身分——指名查哪支代號就照實回傳那家公司的資料。TPEx 沒有 englishAddress、industryName 欄位，
 *       一律是 null（不是查詢失敗，是 TPEx 資料源本來就沒有）。
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
 *         description: 公司基本資料。
 *         content:
 *           application/json:
 *             example:
 *               symbol: "2330"
 *               market: "TWSE"
 *               reportDate: "2026-08-29"
 *               name: "台灣積體電路製造股份有限公司"
 *               shortName: "台積電"
 *               industry: "24"
 *               industryName: "半導體業"
 *               chairman: "魏哲家"
 *               generalManager: "總裁: 魏哲家"
 *               spokesperson: "黃仁昭"
 *               spokespersonTitle: "資深副總經理暨財務長"
 *               establishedDate: "1987-02-21"
 *               listedDate: "1994-09-05"
 *               parValue: "10"
 *               paidInCapital: "259323700670"
 *               financialReportType: "1"
 *               financialReportTypeName: "個別財報"
 *               issuedShares: "25932370067"
 *               englishShortName: "TSMC"
 *               website: "https://www.tsmc.com"
 *       404:
 *         description: 上市、上櫃都查無此股票代號的公司基本資料。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
stockRouter.get("/:symbol/profile", async (req, res) => {
  const { symbol } = req.params;
  const profile = await getCompanyProfile(symbol);
  if (!profile) {
    throw new AppError(`No company profile found for symbol "${symbol}"`, 404);
  }
  res.json(profile);
});

/**
 * @swagger
 * /stocks/{symbol}/capital-stock-history:
 *   get:
 *     summary: 查詢股本歷史（實收股本/股數變動，含現金增資、公積/盈餘轉增資、合併增資、減資等來源拆解）
 *     description: >
 *       資料來自 oingg-analysis-ts 的 GET /companies/capital-stock-history。entries 由新到舊排序；
 *       changeSource 底下 5 個金額欄位固定同時存在（不相關的來源是 "0" 而非缺席），可能同時多個來源非零
 *       （約 9% 的資料如此），capitalReduction 可能是負數，不要取絕對值。sharesChangePercent 是跟「時間
 *       序上更早」那筆比較的流通股數變動百分比——因為 entries 是新到舊排序，「更早」指的是陣列裡的下一筆
 *       （index+1），不是上一筆；最舊一筆没有更早的可比較，是 null。查無資料回傳空陣列，不是 404。
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
 *         description: 股本歷史，查無資料時 entries 為空陣列。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
stockRouter.get("/:symbol/capital-stock-history", async (req, res) => {
  const { symbol } = req.params;
  const history = await getCapitalStockHistory(symbol);
  res.json(history);
});
