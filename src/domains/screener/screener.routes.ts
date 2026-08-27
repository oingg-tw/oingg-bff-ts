import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { toFieldRefString } from "../../shared/fieldRef.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { runScreener } from "./screener.service.js";
import { parseScreenerFilters } from "./screenerFilterInput.js";
import { listColumnPreferences } from "./screenerColumns.repository.js";
import type { ScreenerFilter } from "./screener.types.js";

export const screenerRouter = Router();

screenerRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseFilters(body: unknown): ScreenerFilter[] {
  return parseScreenerFilters((body as { filters?: unknown } | null)?.filters);
}

/**
 * @swagger
 * /screener:
 *   post:
 *     summary: 依 filterCatalog 指標篩選個股
 *     description: >
 *       field 格式為 "<metricKey>.<fieldKey>"（例如 "margins.grossMarginTtm"），對應 GET /filters
 *       回傳的分類/指標/欄位目錄。每個指標會取該股票最新一筆合併報表（非子公司）的數值來比對，
 *       不同指標之間用 AND 合併。回傳的欄位由使用者透過 GET/PUT /screener/columns 設定的偏好決定，
 *       沒設定就只回傳 symbol。
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
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
 *     responses:
 *       200:
 *         description: 符合條件的股票清單，附上使用者設定的顯示欄位數值。
 *       400:
 *         description: 請求格式錯誤，或 field 不存在於 filterCatalog。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       501:
 *         description: field 對應的指標存在於 filterCatalog，但這個服務還沒接上 analysis DB 對應的表。
 */
screenerRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const filters = parseFilters(req.body);

  const columnPreferences = await listColumnPreferences(firebaseUid);
  const columns = columnPreferences.map((c) => ({ field: toFieldRefString(c.metricKey, c.fieldKey) }));

  const result = await runScreener(filters, columns);
  res.json(result);
});
