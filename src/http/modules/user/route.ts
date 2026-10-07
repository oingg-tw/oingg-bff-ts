import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { parseBody } from "@/shared/validation.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import {
  getPreferredStocksPreferences,
  updatePreferredStocksPreferences,
} from "@/application/user/preferredStocksPreferences.service.js";
import type { PreferredStocksPreferencesDeps } from "@/application/user/preferredStocksPreferences.service.js";
import { getDisplaySettings, updateShowAsOfDate } from "@/application/user/screenerDisplaySettings.service.js";
import type { ScreenerDisplaySettingsDeps } from "@/application/user/screenerDisplaySettings.service.js";
import {
  getThemePreference,
  updateIsFullWidth,
  updateMarketColorConvention,
  updateThemeAccentColor,
  updateThemeMode,
} from "@/application/user/theme.service.js";
import type { ThemeDeps } from "@/application/user/theme.service.js";
import { getOrCreateUserFromToken } from "@/application/user/user.service.js";
import { getHoldingColumns, updateHoldingColumns, type HoldingColumnsDeps } from "@/application/user/holdingColumns.service.js";
import { getWatchlistColumns, updateWatchlistColumns, type WatchlistColumnsDeps } from "@/application/user/watchlistColumns.service.js";
import type { UserDeps } from "@/application/user/user.service.js";

/**
 * 這支路由同時服務帳號本體與五組偏好設定，所以它要的依賴是各 use case 宣告的聯集——寫成交集型別而不是
 * 直接收整包 AppDeps，路由需要的東西多一項就會在這裡顯現，而不是默默變成「什麼都摸得到」。
 */
type UserRouterDeps = UserDeps &
  ThemeDeps &
  ScreenerDisplaySettingsDeps &
  PreferredStocksPreferencesDeps &
  HoldingColumnsDeps &
  WatchlistColumnsDeps &
  AuthMiddlewareDeps;

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

export const updateThemeModeSchema = z.object({ mode: z.enum(["LIGHT", "DARK", "SYSTEM"]) });
export const updateThemeAccentColorSchema = z.object({
  accentColor: z.enum(["BLUE", "GREEN", "PURPLE", "ORANGE", "RED", "TEAL", "GOLD"]),
});
export const updateMarketColorConventionSchema = z.object({
  marketColorConvention: z.enum(["ASIA", "WESTERN", "ACCESSIBLE"]),
});
export const updateFullWidthSchema = z.object({ isFullWidth: z.boolean() });
export const updateShowAsOfDateSchema = z.object({ showAsOfDate: z.boolean() });

/**
 * 持股頁自訂欄位的信任邊界（2026-10-05，範圍照 web-nuxt 提的規格）。公式只驗長度，不驗語意——bff-ts
 * 不解析它，計算發生在瀏覽器裡。
 *
 * 50 欄是**跟方案無關的硬上限**，屬於輸入驗證：不設的話一個請求就能塞進任意大的 JSON。方案的額度
 * （customHoldingColumns）是另一回事，在 service 裡判斷。
 */
export const HOLDING_COLUMNS_HARD_LIMIT = 50;
export const updateHoldingColumnsSchema = z.object({
  columns: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().trim().min(1, '"label" must not be blank').max(20),
        formula: z.string().min(1).max(200),
        format: z.enum(["number", "percent", "money"]),
        decimals: z.number().int().min(0).max(4),
      }),
    )
    .max(HOLDING_COLUMNS_HARD_LIMIT),
});
/**
 * 自選股表格的顯示欄位（2026-10-06，規格照 web-nuxt 提的）。20 欄是使用者定的**跟方案無關的硬上限**；
 * 方案額度（watchlistColumns）與 field 是否認得都在 service 裡判斷。
 */
export const WATCHLIST_COLUMNS_HARD_LIMIT = 20;
export const updateWatchlistColumnsSchema = z.object({
  columns: z
    .array(
      z.object({
        field: z.string().trim().min(1).max(120),
        label: z.string().trim().min(1, '"label" must not be blank').max(60),
      }),
    )
    .max(WATCHLIST_COLUMNS_HARD_LIMIT),
});
export const updatePreferredStocksPreferencesSchema = z.object({
  columnPresetId: z.enum(["ALL", "CONTRACT_TERMS", "VALUATION", "CALL_RISK"]),
  columnOrder: z.array(z.string()),
});

/**
 * 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。
 * 這是 http 層不再依賴 infrastructure 的關鍵——它只認得 application 匯出的型別。
 */
export function createUserRouter(deps: UserRouterDeps): Router {
  const userRouter = Router();
  // 建一次、十四條路由共用——每條各自 createRequireAuth(deps) 會產生十四個一模一樣的 closure。
  const requireAuth = createRequireAuth(deps);

  // Provisions the row on first contact rather than 404ing a caller Firebase has already vouched for.
  // This is the only place a User row is created, and it's why the frontend should call it on login:
  // `createdAt` is what the 14-day reverse trial is measured from (see billing/entitlement.service.ts).
  // req.user is the token requireAuth already verified — identity never comes from the request body.
  userRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      throw new AppError("Authenticated request is missing decoded user", 401);
    }
    res.json({ user: await getOrCreateUserFromToken(req.user, deps) });
  });

  userRouter.get("/me/theme", requireAuth, async (req: AuthenticatedRequest, res) => {
    const theme = await getThemePreference(requireUser(req), deps);
    res.json({ theme });
  });

  userRouter.put("/me/theme/mode", requireAuth, async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(updateThemeModeSchema, req.body);
    const theme = await updateThemeMode(firebaseUid, body.mode, deps);
    res.json({ theme });
  });

  userRouter.put("/me/theme/accent-color", requireAuth, async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(updateThemeAccentColorSchema, req.body);
    const theme = await updateThemeAccentColor(firebaseUid, body.accentColor, deps);
    res.json({ theme });
  });

  userRouter.put("/me/theme/market-color-convention", requireAuth, async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(updateMarketColorConventionSchema, req.body);
    const theme = await updateMarketColorConvention(firebaseUid, body.marketColorConvention, deps);
    res.json({ theme });
  });

  userRouter.put("/me/theme/full-width", requireAuth, async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(updateFullWidthSchema, req.body);
    const theme = await updateIsFullWidth(firebaseUid, body.isFullWidth, deps);
    res.json({ theme });
  });

  userRouter.get("/me/screener-display-settings", requireAuth, async (req: AuthenticatedRequest, res) => {
    const displaySettings = await getDisplaySettings(requireUser(req), deps);
    res.json({ displaySettings });
  });

  userRouter.put(
    "/me/screener-display-settings/show-as-of-date",
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      const firebaseUid = requireUser(req);
      const body = parseBody(updateShowAsOfDateSchema, req.body);
      const displaySettings = await updateShowAsOfDate(firebaseUid, body.showAsOfDate, deps);
      res.json({ displaySettings });
    },
  );

  userRouter.get("/me/holding-columns", requireAuth, async (req: AuthenticatedRequest, res) => {
    const holdingColumns = await getHoldingColumns(requireUser(req), deps);
    res.json({ holdingColumns });
  });

  userRouter.put("/me/holding-columns", requireAuth, async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(updateHoldingColumnsSchema, req.body);
    const holdingColumns = await updateHoldingColumns(firebaseUid, body.columns, deps);
    res.json({ holdingColumns });
  });

  userRouter.get("/me/watchlist-columns", requireAuth, async (req: AuthenticatedRequest, res) => {
    const watchlistColumns = await getWatchlistColumns(requireUser(req), deps);
    res.json({ watchlistColumns });
  });

  userRouter.put("/me/watchlist-columns", requireAuth, async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(updateWatchlistColumnsSchema, req.body);
    const watchlistColumns = await updateWatchlistColumns(firebaseUid, body.columns, deps);
    res.json({ watchlistColumns });
  });

  userRouter.get("/me/preferred-stocks-preferences", requireAuth, async (req: AuthenticatedRequest, res) => {
    const preferredStocksPreferences = await getPreferredStocksPreferences(requireUser(req), deps);
    res.json({ preferredStocksPreferences });
  });

  userRouter.put("/me/preferred-stocks-preferences", requireAuth, async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(updatePreferredStocksPreferencesSchema, req.body);
    const preferredStocksPreferences = await updatePreferredStocksPreferences(
      firebaseUid,
      body.columnPresetId,
      body.columnOrder,
      deps,
    );
    res.json({ preferredStocksPreferences });
  });

  return userRouter;
}
