import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { getColumnPreferences, setColumnPreferences } from "./screenerColumns.service.js";

export const screenerColumnsRouter = Router();

screenerColumnsRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseColumnFields(body: unknown): string[] {
  const columns = (body as { columns?: unknown } | null)?.columns;
  if (!Array.isArray(columns)) {
    throw new AppError('"columns" must be an array', 400);
  }
  return columns.map((raw, index) => {
    const field = (raw as { field?: unknown } | null)?.field;
    if (typeof field !== "string" || field.trim() === "") {
      throw new AppError(`columns[${index}].field is required`, 400);
    }
    return field;
  });
}

/**
 * @swagger
 * /screener/columns:
 *   get:
 *     summary: 查詢目前使用者設定的 screener 顯示欄位
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 使用者設定的欄位清單（依設定順序排列）。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
screenerColumnsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const columns = await getColumnPreferences(firebaseUid);
  res.json({ columns });
});

/**
 * @swagger
 * /screener/columns:
 *   put:
 *     summary: 設定 screener 要顯示的欄位（整組覆蓋，不是增量）
 *     description: field 格式跟 /screener 的 filters 一樣是 "<metricKey>.<fieldKey>"，順序就是顯示順序。
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
 *               - columns
 *             properties:
 *               columns:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - field
 *                   properties:
 *                     field:
 *                       type: string
 *                       example: "margins.grossMarginTtm"
 *     responses:
 *       200:
 *         description: 設定後的欄位清單。
 *       400:
 *         description: 請求格式錯誤，或有 field 不存在於 filterCatalog。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
screenerColumnsRouter.put("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const fields = parseColumnFields(req.body);

  await setColumnPreferences(firebaseUid, fields);
  const columns = await getColumnPreferences(firebaseUid);
  res.json({ columns });
});
