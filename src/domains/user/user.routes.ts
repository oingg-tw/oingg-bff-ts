import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import { requireAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import { getDashboardCardSettings, updateDashboardCardSettings } from "@/domains/user/dashboardCardSettings.service.js";
import { getDisplaySettings, updateShowAsOfDate } from "@/domains/user/screenerDisplaySettings.service.js";
import {
  getThemePreference,
  updateIsFullWidth,
  updateMarketColorConvention,
  updateThemeAccentColor,
  updateThemeMode,
} from "@/domains/user/theme.service.js";
import { getUserByFirebaseUidOrThrow } from "@/domains/user/user.service.js";

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
 *       尚未設定過的欄位回傳系統預設值（mode: SYSTEM, accentColor: GOLD, marketColorConvention: ASIA,
 *       isFullWidth: true——符合目前上線版面本來就是滿版的實際狀態），不是寫死在使用者資料裡的快照——
 *       之後調整系統預設，沒特別設定過的使用者會直接跟著變。
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
 *                     isFullWidth:
 *                       type: boolean
 *             example:
 *               theme:
 *                 mode: DARK
 *                 accentColor: PURPLE
 *                 marketColorConvention: ASIA
 *                 isFullWidth: true
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
 *                     isFullWidth:
 *                       type: boolean
 *             example:
 *               theme:
 *                 mode: DARK
 *                 accentColor: PURPLE
 *                 marketColorConvention: ASIA
 *                 isFullWidth: true
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
 *                     isFullWidth:
 *                       type: boolean
 *             example:
 *               theme:
 *                 mode: DARK
 *                 accentColor: PURPLE
 *                 marketColorConvention: ASIA
 *                 isFullWidth: true
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
 *                     isFullWidth:
 *                       type: boolean
 *             example:
 *               theme:
 *                 mode: DARK
 *                 accentColor: PURPLE
 *                 marketColorConvention: ASIA
 *                 isFullWidth: true
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

/**
 * @swagger
 * /users/me/theme/full-width:
 *   put:
 *     summary: 更新「視覺滿版」設定
 *     description: >
 *       整個 app 通用的版面偏好（主內容區是否佔滿整個頁面寬度），不限定某個功能頁面。系統預設 true
 *       （滿版），對應目前上線版面本來就是滿版的實際狀態；false 是新的「置中」選配。
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
 *               - isFullWidth
 *             properties:
 *               isFullWidth:
 *                 type: boolean
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
 *                     isFullWidth:
 *                       type: boolean
 *             example:
 *               theme:
 *                 mode: DARK
 *                 accentColor: PURPLE
 *                 marketColorConvention: ASIA
 *                 isFullWidth: true
 *       400:
 *         description: isFullWidth 不是布林值。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
userRouter.put("/me/theme/full-width", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { isFullWidth?: unknown } | null;
  const theme = await updateIsFullWidth(firebaseUid, body?.isFullWidth);
  res.json({ theme });
});

/**
 * @swagger
 * /users/me/screener-display-settings:
 *   get:
 *     summary: 查詢目前登入使用者的 screener 顯示設定
 *     description: >
 *       目前只有一項：showAsOfDate（screener/ranking 結果表格是否顯示每個數值的資料時間，見 asOfDate）。
 *       只有已登入使用者能用這個設定（未登入的 screener 呼叫不會套用任何顯示設定）。尚未設定過回傳系統
 *       預設值（false，不顯示），不是寫死在使用者資料裡的快照——之後調整系統預設，沒特別設定過的使用者
 *       會直接跟著變。
 *     tags:
 *       - User
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
userRouter.get("/me/screener-display-settings", requireAuth, async (req: AuthenticatedRequest, res) => {
  const displaySettings = await getDisplaySettings(requireUser(req));
  res.json({ displaySettings });
});

/**
 * @swagger
 * /users/me/screener-display-settings/show-as-of-date:
 *   put:
 *     summary: 更新「是否顯示資料時間」設定
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
userRouter.put(
  "/me/screener-display-settings/show-as-of-date",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = req.body as { showAsOfDate?: unknown } | null;
    const displaySettings = await updateShowAsOfDate(firebaseUid, body?.showAsOfDate);
    res.json({ displaySettings });
  },
);

/**
 * @swagger
 * /users/me/dashboard-cards:
 *   get:
 *     summary: 查詢目前登入使用者的首頁卡片顯示偏好
 *     description: >
 *       visibleCardIds 沒設定過是 null（不是 []）——null 代表「還沒存過偏好」，[] 代表「使用者主動把每張
 *       卡片都關掉」，兩者語意不同。卡片 id 是前端自訂、會持續增加的清單，這個服務不驗證/不知道目前完整
 *       清單有哪些，null 時前端應該自行套用自己的預設清單。
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 顯示偏好，包在 "dashboardCards" 這個 key 底下。
 *         content:
 *           application/json:
 *             example:
 *               dashboardCards:
 *                 visibleCardIds: ["margin-short-ratio", "revenue-ranking", "volume-top20"]
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
userRouter.get("/me/dashboard-cards", requireAuth, async (req: AuthenticatedRequest, res) => {
  const dashboardCards = await getDashboardCardSettings(requireUser(req));
  res.json({ dashboardCards });
});

/**
 * @swagger
 * /users/me/dashboard-cards:
 *   put:
 *     summary: 更新目前登入使用者的首頁卡片顯示偏好
 *     description: 完整覆蓋整份清單（不是增量新增/刪除單一卡片）——前端要保留哪些卡片，就把完整清單傳過來。
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
 *               - visibleCardIds
 *             properties:
 *               visibleCardIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: 更新後的顯示偏好，包在 "dashboardCards" 這個 key 底下（跟 GET 同一個 shape）。
 *         content:
 *           application/json:
 *             example:
 *               dashboardCards:
 *                 visibleCardIds: ["margin-short-ratio", "volume-top20"]
 *       400:
 *         description: visibleCardIds 沒給，或不是字串陣列。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
userRouter.put("/me/dashboard-cards", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { visibleCardIds?: unknown } | null;
  const dashboardCards = await updateDashboardCardSettings(firebaseUid, body?.visibleCardIds);
  res.json({ dashboardCards });
});
