import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import {
  getThemePreference,
  updateMarketColorConvention,
  updateThemeAccentColor,
  updateThemeMode,
} from "./theme.service.js";
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
 *       尚未設定過的欄位回傳系統預設值（mode: SYSTEM, accentColor: GOLD, marketColorConvention: ASIA），
 *       不是寫死在使用者資料裡的快照——之後調整系統預設，沒特別設定過的使用者會直接跟著變。
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: >
 *           主題設定，包在 "theme" 這個 key 底下（不是扁平物件）——見 schema。
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 theme:
 *                   type: object
 *                   properties:
 *                     mode:
 *                       type: string
 *                       enum: [LIGHT, DARK, SYSTEM]
 *                     accentColor:
 *                       type: string
 *                       enum: [BLUE, GREEN, PURPLE, ORANGE, RED, TEAL, GOLD]
 *                     marketColorConvention:
 *                       type: string
 *                       enum: [ASIA, WESTERN, ACCESSIBLE]
 *             example:
 *               theme:
 *                 mode: DARK
 *                 accentColor: PURPLE
 *                 marketColorConvention: ASIA
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
userRouter.get("/me/theme", requireAuth, async (req: AuthenticatedRequest, res) => {
  const theme = await getThemePreference(requireUser(req));
  res.json({ theme });
});

/**
 * @swagger
 * /users/me/theme/mode:
 *   put:
 *     summary: 更新外觀模式（淺色／深色／跟隨系統）
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mode
 *             properties:
 *               mode:
 *                 type: string
 *                 enum: [LIGHT, DARK, SYSTEM]
 *     responses:
 *       200:
 *         description: >
 *           更新後的完整主題設定，包在 "theme" 這個 key 底下（跟 GET /users/me/theme 同一個 shape）。
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 theme:
 *                   type: object
 *                   properties:
 *                     mode:
 *                       type: string
 *                       enum: [LIGHT, DARK, SYSTEM]
 *                     accentColor:
 *                       type: string
 *                       enum: [BLUE, GREEN, PURPLE, ORANGE, RED, TEAL, GOLD]
 *                     marketColorConvention:
 *                       type: string
 *                       enum: [ASIA, WESTERN, ACCESSIBLE]
 *             example:
 *               theme:
 *                 mode: DARK
 *                 accentColor: PURPLE
 *                 marketColorConvention: ASIA
 *       400:
 *         description: mode 沒給，或不在允許的選項內。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
userRouter.put("/me/theme/mode", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { mode?: unknown } | null;
  const theme = await updateThemeMode(firebaseUid, body?.mode);
  res.json({ theme });
});

/**
 * @swagger
 * /users/me/theme/accent-color:
 *   put:
 *     summary: 更新主題色
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accentColor
 *             properties:
 *               accentColor:
 *                 type: string
 *                 enum: [BLUE, GREEN, PURPLE, ORANGE, RED, TEAL, GOLD]
 *     responses:
 *       200:
 *         description: >
 *           更新後的完整主題設定，包在 "theme" 這個 key 底下（跟 GET /users/me/theme 同一個 shape）。
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 theme:
 *                   type: object
 *                   properties:
 *                     mode:
 *                       type: string
 *                       enum: [LIGHT, DARK, SYSTEM]
 *                     accentColor:
 *                       type: string
 *                       enum: [BLUE, GREEN, PURPLE, ORANGE, RED, TEAL, GOLD]
 *                     marketColorConvention:
 *                       type: string
 *                       enum: [ASIA, WESTERN, ACCESSIBLE]
 *             example:
 *               theme:
 *                 mode: DARK
 *                 accentColor: PURPLE
 *                 marketColorConvention: ASIA
 *       400:
 *         description: accentColor 沒給，或不在允許的選項內。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
userRouter.put("/me/theme/accent-color", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { accentColor?: unknown } | null;
  const theme = await updateThemeAccentColor(firebaseUid, body?.accentColor);
  res.json({ theme });
});

/**
 * @swagger
 * /users/me/theme/market-color-convention:
 *   put:
 *     summary: 更新漲跌顏色慣例
 *     description: ASIA（紅漲綠跌，台股慣例，系統預設）、WESTERN（紅跌綠漲，歐美慣例），或 ACCESSIBLE（色盲友善藍橘配色，取代紅綠）。
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - marketColorConvention
 *             properties:
 *               marketColorConvention:
 *                 type: string
 *                 enum: [ASIA, WESTERN, ACCESSIBLE]
 *     responses:
 *       200:
 *         description: >
 *           更新後的完整主題設定，包在 "theme" 這個 key 底下（跟 GET /users/me/theme 同一個 shape）。
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 theme:
 *                   type: object
 *                   properties:
 *                     mode:
 *                       type: string
 *                       enum: [LIGHT, DARK, SYSTEM]
 *                     accentColor:
 *                       type: string
 *                       enum: [BLUE, GREEN, PURPLE, ORANGE, RED, TEAL, GOLD]
 *                     marketColorConvention:
 *                       type: string
 *                       enum: [ASIA, WESTERN, ACCESSIBLE]
 *             example:
 *               theme:
 *                 mode: DARK
 *                 accentColor: PURPLE
 *                 marketColorConvention: ASIA
 *       400:
 *         description: marketColorConvention 沒給，或不在允許的選項內。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
userRouter.put("/me/theme/market-color-convention", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { marketColorConvention?: unknown } | null;
  const theme = await updateMarketColorConvention(firebaseUid, body?.marketColorConvention);
  res.json({ theme });
});
