import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { optionalAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { runScreener } from "./screener.service.js";
import { resolveScreenerColumns } from "./columnPresets.service.js";
import { parsePagination } from "./pagination.js";
import { parseScreenerFilters } from "./screenerFilterInput.js";
import type { ScreenerFilter } from "./screener.types.js";

export const screenerRouter = Router();

// Guests can screen without an account — only saving a filter set as a named preset
// (POST /screener/presets) requires signing in. A valid token still personalizes the
// column resolution below (the caller's own default column preset); no token just falls
// through to the system default columns.
screenerRouter.use(optionalAuth);

function parseFilters(body: unknown): ScreenerFilter[] {
  return parseScreenerFilters((body as { filters?: unknown } | null)?.filters);
}

function parseOptionalColumnPresetId(body: unknown): number | undefined {
  const value = (body as { columnPresetId?: unknown } | null)?.columnPresetId;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new AppError('"columnPresetId" must be a positive integer', 400);
  }
  return value;
}

/**
 * @swagger
 * /screener:
 *   post:
 *     summary: 依 filterCatalog 指標篩選個股
 *     description: >
 *       不需要登入即可使用（僅儲存為具名 preset 才需要，見 POST /screener/presets）。
 *
 *       field 格式為 "<metricKey>.<fieldKey>"（例如 "margins.grossMarginTtm"），對應 GET /filters
 *       回傳的分類/指標/欄位目錄。每個指標會取該股票最新一筆合併報表（非子公司）的數值來比對，
 *       不同指標之間用 AND 合併。
 *
 *       顯示欄位由 columnPresetId 決定：有給就用那組（見 GET /screener/column-presets，僅限已登入）；
 *       沒給、但帶有效 Authorization header，就用該帳號自己設的預設欄位組合（isDefault=true 那組），
 *       找不到就用系統內建的常用欄位（股價、PER、PBR、殖利率）；未登入一律套用系統內建欄位。回應的
 *       columnPresetId 會標明實際套用的是哪一組（null 代表用的是系統內建，不是使用者自己儲存的組合）。
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
 *                       example: "margins.grossMarginTtm"
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
 *                 type: integer
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
 *       400:
 *         description: 請求格式錯誤，field 不存在於 filterCatalog，或 page/pageSize 不合法。
 *       401:
 *         description: 帶了 Authorization header，但 token 無效或過期（完全不帶則視為匿名請求，不會 401）。
 *       404:
 *         description: 指定的 columnPresetId 不存在，或不屬於目前登入的使用者。
 *       501:
 *         description: field 對應的指標存在於 filterCatalog，但這個服務還沒接上 analysis DB 對應的表。
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
