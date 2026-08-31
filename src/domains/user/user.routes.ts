import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { getThemePreference, updateThemePreference } from "./theme.service.js";
import type { MarketColorConvention, ThemeAccentColor, ThemeMode } from "./theme.types.js";
import { getUserByFirebaseUidOrThrow } from "./user.service.js";

export const userRouter = Router();

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: 查詢目前登入使用者的 user profile
 *     description: 依 Firebase token 的 uid 查詢這個服務自己 DB 裡的 users 表（見 user.service.ts）。目前沒有 signup/首次登入自動建檔流程，查無資料回 404。
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: user profile。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 找不到對應此 Firebase uid 的使用者。
 */
userRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const profile = await getUserByFirebaseUidOrThrow(requireUser(req));
  res.json({ user: profile });
});

/**
 * @swagger
 * /users/me/theme:
 *   get:
 *     summary: 查詢目前登入使用者的 UI 主題設定
 *     description: >
 *       尚未設定過的欄位回傳系統預設值（mode: SYSTEM, accentColor: BLUE, marketColorConvention: ASIA），
 *       不是寫死在使用者資料裡的快照——之後調整系統預設，沒特別設定過的使用者會直接跟著變。
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 主題設定（mode + accentColor）。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
userRouter.get("/me/theme", requireAuth, async (req: AuthenticatedRequest, res) => {
  const theme = await getThemePreference(requireUser(req));
  res.json({ theme });
});

/**
 * @swagger
 * /users/me/theme:
 *   put:
 *     summary: 更新目前登入使用者的 UI 主題設定
 *     description: >
 *       mode／accentColor／marketColorConvention 皆選填，但至少要給一個；沒給的欄位維持原本設定（或系統預設）
 *       不變。marketColorConvention 決定漲跌顏色：ASIA（紅漲綠跌，台股慣例，系統預設）或 WESTERN（紅跌綠漲，
 *       歐美慣例）。
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mode:
 *                 type: string
 *                 enum: [LIGHT, DARK, SYSTEM]
 *               accentColor:
 *                 type: string
 *                 enum: [BLUE, GREEN, PURPLE, ORANGE, RED, TEAL, GOLD]
 *               marketColorConvention:
 *                 type: string
 *                 enum: [ASIA, WESTERN]
 *     responses:
 *       200:
 *         description: 更新後的主題設定。
 *       400:
 *         description: mode/accentColor/marketColorConvention 都沒給，或值不在允許的選項內。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
userRouter.put("/me/theme", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { mode?: unknown; accentColor?: unknown; marketColorConvention?: unknown } | null;

  const theme = await updateThemePreference(firebaseUid, {
    mode: body?.mode as ThemeMode | undefined,
    accentColor: body?.accentColor as ThemeAccentColor | undefined,
    marketColorConvention: body?.marketColorConvention as MarketColorConvention | undefined,
  });
  res.json({ theme });
});
