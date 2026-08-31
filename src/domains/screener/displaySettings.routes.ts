import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { getDisplaySettings, updateShowAsOfDate } from "./displaySettings.service.js";

export const displaySettingsRouter = Router();

displaySettingsRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

/**
 * @swagger
 * /screener/display-settings:
 *   get:
 *     summary: 查詢目前登入使用者的 screener 顯示設定
 *     description: >
 *       目前只有一項：showAsOfDate（結果表格是否顯示每個數值的資料時間，見 asOfDate）。尚未設定過回傳
 *       系統預設值（false，不顯示），不是寫死在使用者資料裡的快照——之後調整系統預設，沒特別設定過的
 *       使用者會直接跟著變。
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 顯示設定。
 *         content:
 *           application/json:
 *             example:
 *               displaySettings:
 *                 showAsOfDate: false
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
displaySettingsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const displaySettings = await getDisplaySettings(requireUser(req));
  res.json({ displaySettings });
});

/**
 * @swagger
 * /screener/display-settings/show-as-of-date:
 *   put:
 *     summary: 更新「是否顯示資料時間」設定
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
 *               - showAsOfDate
 *             properties:
 *               showAsOfDate:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: 更新後的顯示設定。
 *       400:
 *         description: showAsOfDate 不是布林值。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
displaySettingsRouter.put("/show-as-of-date", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { showAsOfDate?: unknown } | null;
  const displaySettings = await updateShowAsOfDate(firebaseUid, body?.showAsOfDate);
  res.json({ displaySettings });
});
