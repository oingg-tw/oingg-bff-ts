import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { optionalAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import { runRanking, runScreener } from "@/domains/screener/screener.service.js";
import { resolveScreenerColumns } from "@/domains/screener/columnPresets.service.js";
import { parsePagination } from "@/domains/screener/pagination.js";
import { parseScreenerFilters } from "@/domains/screener/screenerFilterInput.js";
import type { ScreenerColumnRef, ScreenerFilter } from "@/domains/screener/screener.types.js";

const DEFAULT_RANKING_LIMIT = 10;
const MAX_RANKING_LIMIT = 50;

export const screenerRouter = Router();

// Guests can screen without an account — only saving a filter set as a named preset
// (POST /screener/presets) requires signing in. A valid token still personalizes the
// column resolution below (the caller's own default column preset); no token just falls
// through to the system default columns.
screenerRouter.use(optionalAuth);

function parseFilters(body: unknown): ScreenerFilter[] {
  return parseScreenerFilters((body as { filters?: unknown } | null)?.filters);
}

function parseOptionalColumnPresetId(body: unknown): string | undefined {
  const value = (body as { columnPresetId?: unknown } | null)?.columnPresetId;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new AppError('"columnPresetId" must be a UUID string', 400);
  }
  return parseUuidParam(value, "column preset");
}

/**
 * @swagger
 * /screener:
 *   post:
 *     summary: 依 filterCatalog 指標篩選個股
 *     description: >
 *       不需要登入即可使用（僅儲存為具名 preset 才需要，見 POST /screener/presets）。
 *
 *       field 格式為 "<metricKey>.<fieldKey>"（例如 "grossMargin.grossMarginTtm"），對應 GET /filters
 *       回傳的分類/指標/欄位目錄。每個指標會取該股票最新一筆合併報表（非子公司）的數值來比對，
 *       不同指標之間用 AND 合併。
 *
 *       顯示欄位由 columnPresetId 決定：有給就用那組（見 GET /screener/column-presets，僅限已登入）；
 *       沒給、但帶有效 Authorization header，就用該帳號自己設的預設欄位組合（isDefault=true 那組），
 *       找不到就用系統內建的常用欄位（股價、PER、PBR、殖利率）；未登入一律套用系統內建欄位。回應的
 *       columnPresetId 會標明實際套用的是哪一組（null 代表用的是系統內建，不是使用者自己儲存的組合）。
 *
 *       每個 results[].values 底下的欄位都是 `{ value, asOfDate }` 物件，不是純值——不是查詢當下時間。
 *       季報類指標（例如 roe）的 asOfDate 是 "{兩位數年}Q{季別}"（例如 "26Q2"）；日頻／技術指標
 *       （例如 stock.price）則是實際日期（"YYYY-MM-DD"）。不同股票同一欄位可能不同（例如某公司
 *       財報還沒公布，抓到的還是上一季）。
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filters
 *             properties:
 *               filters:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - field
 *                   properties:
 *                     field:
 *                       type: string
 *                       example: "grossMargin.grossMarginTtm"
 *                     min:
 *                       type: number
 *                       nullable: true
 *                       example: 20
 *                     max:
 *                       type: number
 *                       nullable: true
 *                       example: null
 *                     exclude:
 *                       type: boolean
 *                       default: false
 *                       description: false（預設）＝保留 min~max 範圍內的股票；true＝反過來，保留範圍外的股票
 *               columnPresetId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: 要用哪組顯示欄位（見上方說明），省略則自動選一組。
 *               page:
 *                 type: integer
 *                 default: 1
 *                 description: 頁碼（從 1 開始）。
 *               pageSize:
 *                 type: integer
 *                 default: 50
 *                 description: 每頁筆數，最多 200。
 *     responses:
 *       200:
 *         description: 符合條件的股票清單（這一頁的部分），附上總筆數/頁碼/總頁數，以及實際套用的 columnPresetId。
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 pageSize:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *                 columnPresetId:
 *                   type: string
 *                   nullable: true
 *                 columns:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       field:
 *                         type: string
 *                       metricName:
 *                         type: string
 *                       fieldName:
 *                         type: string
 *                       unit:
 *                         type: string
 *                         nullable: true
 *                         description: 顯示單位（例如 "percent"／"currency"／"times"／"ratio"），來自 analysis-ts 的 /filters 目錄，還沒設定時為 null。
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       symbol:
 *                         type: string
 *                       values:
 *                         type: object
 *                         description: 每個 key 是一個 field（例如 "per.peRatio"），value 固定是 { value, asOfDate } 物件。
 *                         additionalProperties:
 *                           type: object
 *                           properties:
 *                             value:
 *                               nullable: true
 *                             asOfDate:
 *                               type: string
 *                               nullable: true
 *                               description: >
 *                                 該數字所屬的期間。季報類指標是 "{兩位數年}Q{季別}"（例如 "26Q2"）；
 *                                 日頻／技術指標是實際日期（"YYYY-MM-DD"）；可能是 null（該來源沒有
 *                                 日期概念時）。
 *             example:
 *               count: 1
 *               page: 1
 *               pageSize: 50
 *               totalPages: 1
 *               columnPresetId: null
 *               columns: [{ field: "per.peRatio", metricName: "本益比 PER", fieldName: "本益比 PER", unit: "times" }]
 *               results:
 *                 - symbol: "2330"
 *                   values:
 *                     per.peRatio: { value: "27.82", asOfDate: "2026-08-16" }
 *       400:
 *         description: 請求格式錯誤，field 不存在於 filterCatalog，或 page/pageSize 不合法。
 *       401:
 *         description: 帶了 Authorization header，但 token 無效或過期（完全不帶則視為匿名請求，不會 401）。
 *       404:
 *         description: 指定的 columnPresetId 不存在，或不屬於目前登入的使用者。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
screenerRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = req.user?.uid;
  const filters = parseFilters(req.body);
  const requestedColumnPresetId = parseOptionalColumnPresetId(req.body);
  const body = req.body as { page?: unknown; pageSize?: unknown } | null;
  const pagination = parsePagination(body?.page, body?.pageSize);

  const { columnPresetId, columns } = await resolveScreenerColumns(firebaseUid, requestedColumnPresetId);
  const result = await runScreener(filters, columns, pagination);
  res.json({ ...result, columnPresetId });
});

function parseRankingDirection(raw: unknown): "asc" | "desc" {
  if (raw === undefined) {
    return "desc";
  }
  if (raw !== "asc" && raw !== "desc") {
    throw new AppError('"direction" must be "asc" or "desc"', 400);
  }
  return raw;
}

function parseRankingLimit(raw: unknown): number {
  if (raw === undefined) {
    return DEFAULT_RANKING_LIMIT;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError('"limit" must be a positive integer', 400);
  }
  if (value > MAX_RANKING_LIMIT) {
    throw new AppError(`"limit" must be at most ${MAX_RANKING_LIMIT}`, 400);
  }
  return value;
}

function parseRankingColumns(raw: unknown): ScreenerColumnRef[] {
  if (raw === undefined) {
    return [];
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new AppError('"columns" must be a comma-separated string of fields', 400);
  }
  return raw
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean)
    .map((field) => ({ field }));
}

/**
 * @swagger
 * /screener/ranking:
 *   get:
 *     summary: 依單一指標排行（例如殖利率最高、本益比最低）——給首頁卡片用，不是完整篩選
 *     description: >
 *       不需要登入。只依 `field` 這一個指標排序，沒有門檻條件，`direction=asc` 由小到大（例如本益比、
 *       股價淨值比越低越好）、`direction=desc`（預設）由大到小（例如殖利率越高越好）。排行欄位本身一定
 *       會被排除 null（沒有這個數字的公司不會出現），也一定會出現在回傳的 columns/values 裡；`columns`
 *       可以額外加逗號分隔的顯示欄位（含 "stock.price"）。
 *     tags:
 *       - Screener
 *     parameters:
 *       - in: query
 *         name: field
 *         required: true
 *         schema:
 *           type: string
 *         example: "dividendYield.dividendYieldPct"
 *       - in: query
 *         name: direction
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: 最多 50。
 *       - in: query
 *         name: columns
 *         schema:
 *           type: string
 *         description: 逗號分隔的額外顯示欄位，例如 "stock.price"。
 *     responses:
 *       200:
 *         description: >
 *           排行結果（不分頁，就是前 limit 名）。results[].values 底下每個欄位都是 { value, asOfDate }
 *           物件，shape 跟 POST /screener 一致。asOfDate 對季報類指標（例如 roe）是 "{兩位數年}Q{季別}"
 *           格式（例如 "26Q2"），對日頻／技術指標（例如 stock.price、atr）則是實際日期
 *           （"YYYY-MM-DD"）——不同股票同一欄位可能不同（例如某公司財報還沒公布）。
 *         content:
 *           application/json:
 *             example:
 *               field: "roe.roeTtmPct"
 *               direction: "desc"
 *               columns: [{ field: "roe.roeTtmPct", metricName: "股東權益報酬率 ROE", fieldName: "ROE", unit: "percent" }]
 *               results:
 *                 - symbol: "2330"
 *                   values:
 *                     roe.roeTtmPct: { value: "34.78", asOfDate: "26Q2" }
 *       400:
 *         description: 缺少 field，field 不存在於 filterCatalog，或 direction/limit/columns 格式錯誤。
 *       502:
 *         description: analysis-ts 服務無法連線或回應格式異常。
 */
screenerRouter.get("/ranking", async (req, res) => {
  const field = req.query.field;
  if (typeof field !== "string" || field.trim() === "") {
    throw new AppError('"field" query parameter is required', 400);
  }
  const direction = parseRankingDirection(req.query.direction);
  const limit = parseRankingLimit(req.query.limit);
  const columns = parseRankingColumns(req.query.columns);

  const result = await runRanking(field, direction, limit, columns);
  res.json(result);
});
