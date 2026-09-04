import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import { getCapitalStockHistory, getCompanyProfile, getExDividendNotices, getStockQuote } from "@/domains/stock/stock.service.js";

const MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST = 100;

export const stockRouter = Router();

/**
 * @swagger
 * /stocks/ex-dividend-notices:
 *   get:
 *     summary: 批次查詢即將除息/除權的公告
 *     description: >
 *       資料來自 oingg-analysis-ts 的 GET /stocks/ex-dividend-notices。symbols 逗號分隔，一次最多 100 檔
 *       （超過回 400）。查無未來除權息公告的代號不會出現在 notices 裡（不是空陣列）。同一代號的陣列已依
 *       exDate 由近到遠排序。exType「權」底下有兩種互斥欄位組合：股票股利/盈餘轉增資用
 *       stockDividendRatio；現金增資認股用 subscriptionRatio/subscriptionPricePerShare/sharesOffered/
 *       sharesEmpOwner/sharesholderOwner/stockHoldingRatio，不會同時出現。純「息」只有 cashDividend
 *       非 null。sharesOffered 等 4 個現金增資欄位的語意是 analysis-ts 依欄位命名推測，未跟 twse-ts
 *       正式核對過。
 *     tags:
 *       - Stock
 *     parameters:
 *       - in: query
 *         name: symbols
 *         required: true
 *         schema:
 *           type: string
 *         description: 逗號分隔的股票代號，最多 100 檔
 *         example: "2330,00939"
 *     responses:
 *       200:
 *         description: 除權息公告，key 是股票代號，查無公告的代號不會出現。
 *       400:
 *         description: 缺少 symbols 參數，或超過 100 檔。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
stockRouter.get("/ex-dividend-notices", async (req, res) => {
  const symbolsParam = req.query.symbols;
  if (typeof symbolsParam !== "string" || symbolsParam.trim() === "") {
    throw new AppError('Query parameter "symbols" is required (comma-separated stock symbols)', 400);
  }
  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (symbols.length > MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST) {
    throw new AppError(
      `Requested ${symbols.length} symbols at once, but this endpoint caps at ${MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST}`,
      400,
    );
  }
  const notices = await getExDividendNotices(symbols);
  res.json({ notices: Object.fromEntries(notices) });
});

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
