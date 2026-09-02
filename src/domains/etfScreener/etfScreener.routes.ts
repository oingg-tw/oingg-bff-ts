import { Router } from "ultimate-express";
import { getEtfFilterCatalog, runEtfScreener } from "@/domains/etfScreener/etfScreener.service.js";
import {
  parseEtfColumns,
  parseEtfScreenerFilters,
  parseEtfScreenerPagination,
  parseEtfSort,
} from "@/domains/etfScreener/etfScreenerInput.js";

export const etfScreenerRouter = Router();

/**
 * @swagger
 * /etf-screener/filters:
 *   get:
 *     summary: ETF screener 可篩選/顯示欄位目錄
 *     description: >
 *       動態目錄，不是寫死清單——分類欄位（例如 assetClass）的 values 是現查資料庫的 distinct 值，
 *       之後可能會增加。這是 ETF screener 系列功能的第一版，之後應該還會擴充。
 *     tags:
 *       - ETF Screener
 *     responses:
 *       200:
 *         description: 欄位目錄。
 *         content:
 *           application/json:
 *             example:
 *               fields:
 *                 - field: "aum"
 *                   label: "規模（新台幣）"
 *                   kind: "numeric"
 *                 - field: "assetClass"
 *                   label: "資產類型"
 *                   kind: "categorical"
 *                   values: ["國內成分證券", "國外成分證券", "債券成分", "槓桿型", "反向型", "多資產", "連結式"]
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
etfScreenerRouter.get("/filters", async (_req, res) => {
  const catalog = await getEtfFilterCatalog();
  res.json(catalog);
});

/**
 * @swagger
 * /etf-screener:
 *   post:
 *     summary: 依 GET /etf-screener/filters 目錄篩選 ETF
 *     description: >
 *       不需要登入。filters 跟 columns 至少要提供一個（可以只給 columns 列出所有 ETF 不加篩選）。
 *
 *       filters 依欄位種類分兩種形狀：數字欄位用 { field, min, max, exclude? }（語意同股票 screener）；
 *       類別欄位（market/assetClass/isActive）用 { field, values: [...] }（IN 語意，例如
 *       { "field": "market", "values": ["TWSE"] }）。實際欄位要用數字還是類別形狀由 analysis-ts 驗證，
 *       用錯形狀會收到說明是哪個欄位、該用哪種形狀的錯誤訊息。
 *
 *       results[].values 是 Record<field, number|string|boolean|null>，不是像股票 screener 那樣包成
 *       { value, asOfDate } 物件——這是 ETF screener 系列的第一版，形狀之後可能還會調整。
 *       symbol/fundName/shortName/issuerName（投信公司名，不是股票公司對照表）/category（原始分類字串）
 *       固定回傳，不需要放進 columns。expenseRatio 只用最新一個完整年度，發行不滿一年的 ETF 這個欄位是
 *       null（不是整檔被排除）。
 *     tags:
 *       - ETF Screener
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filters:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - field
 *                   properties:
 *                     field:
 *                       type: string
 *                       example: "market"
 *                     min:
 *                       type: number
 *                       nullable: true
 *                     max:
 *                       type: number
 *                       nullable: true
 *                     exclude:
 *                       type: boolean
 *                       default: false
 *                     values:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["TWSE"]
 *               columns:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - field
 *                   properties:
 *                     field:
 *                       type: string
 *                       example: "aum"
 *               page:
 *                 type: integer
 *                 default: 1
 *               pageSize:
 *                 type: integer
 *                 default: 50
 *                 description: 最多 200。
 *               sortField:
 *                 type: string
 *                 description: 要嘛跟 sortOrder 一起給，要嘛都不給；只給一個會 400。
 *               sortOrder:
 *                 type: string
 *                 enum: [asc, desc]
 *     responses:
 *       200:
 *         description: 篩選結果。
 *         content:
 *           application/json:
 *             example:
 *               count: 164
 *               page: 1
 *               pageSize: 2
 *               totalPages: 82
 *               results:
 *                 - symbol: "0050"
 *                   fundName: "元大台灣卓越50基金"
 *                   shortName: "元大台灣50"
 *                   issuerName: "元大投信"
 *                   category: "上市ETF_國內成分證券ETF"
 *                   values:
 *                     aum: 2283731446214
 *                     expenseRatio: 0.02
 *       400:
 *         description: filters/columns 都是空的、欄位不存在，或 filter 形狀跟該欄位的種類不符。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
etfScreenerRouter.post("/", async (req, res) => {
  const body = req.body as
    | { filters?: unknown; columns?: unknown; page?: unknown; pageSize?: unknown; sortField?: unknown; sortOrder?: unknown }
    | null;
  const filters = parseEtfScreenerFilters(body?.filters);
  const columns = parseEtfColumns(body?.columns);
  const { page, pageSize } = parseEtfScreenerPagination(body?.page, body?.pageSize);
  const sort = parseEtfSort(body?.sortField, body?.sortOrder);

  const result = await runEtfScreener(filters, columns, page, pageSize, sort);
  res.json(result);
});
