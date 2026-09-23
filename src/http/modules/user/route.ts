import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { parseBody } from "@/shared/validation.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { getDashboardCardSettings, updateDashboardCardSettings } from "@/application/user/dashboardCardSettings.service.js";
import type { DashboardCardSettingsDeps } from "@/application/user/dashboardCardSettings.service.js";
import {
  getPreferredStocksPreferences,
  updatePreferredStocksPreferences,
} from "@/application/user/preferredStocksPreferences.service.js";
import type { PreferredStocksPreferencesDeps } from "@/application/user/preferredStocksPreferences.service.js";
import { getDisplaySettings, updateShowAsOfDate } from "@/application/user/screenerDisplaySettings.service.js";
import type { ScreenerDisplaySettingsDeps } from "@/application/user/screenerDisplaySettings.service.js";
import {
  getStockDetailPreferences,
  updateStockDetailPreferences,
} from "@/application/user/stockDetailPreferences.service.js";
import type { StockDetailPreferencesDeps } from "@/application/user/stockDetailPreferences.service.js";
import {
  getThemePreference,
  updateIsFullWidth,
  updateMarketColorConvention,
  updateThemeAccentColor,
  updateThemeMode,
} from "@/application/user/theme.service.js";
import type { ThemeDeps } from "@/application/user/theme.service.js";
import { getOrCreateUserFromToken } from "@/application/user/user.service.js";
import type { UserDeps } from "@/application/user/user.service.js";

/**
 * 這支路由同時服務帳號本體與五組偏好設定，所以它要的依賴是各 use case 宣告的聯集——寫成交集型別而不是
 * 直接收整包 AppDeps，路由需要的東西多一項就會在這裡顯現，而不是默默變成「什麼都摸得到」。
 */
type UserRouterDeps = UserDeps &
  ThemeDeps &
  ScreenerDisplaySettingsDeps &
  DashboardCardSettingsDeps &
  StockDetailPreferencesDeps &
  PreferredStocksPreferencesDeps &
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
export const updateDashboardCardsSchema = z.object({ visibleCardIds: z.array(z.string()) });
export const updateStockDetailPreferencesSchema = z.object({
  mode: z.enum(["CARD", "ACCOUNTING"]),
  visibleCardIds: z.array(z.string()),
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

  userRouter.get("/me/dashboard-cards", requireAuth, async (req: AuthenticatedRequest, res) => {
    const dashboardCards = await getDashboardCardSettings(requireUser(req), deps);
    res.json({ dashboardCards });
  });

  userRouter.put("/me/dashboard-cards", requireAuth, async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(updateDashboardCardsSchema, req.body);
    const dashboardCards = await updateDashboardCardSettings(firebaseUid, body.visibleCardIds, deps);
    res.json({ dashboardCards });
  });

  userRouter.get("/me/stock-detail-preferences", requireAuth, async (req: AuthenticatedRequest, res) => {
    const stockDetailPreferences = await getStockDetailPreferences(requireUser(req), deps);
    res.json({ stockDetailPreferences });
  });

  userRouter.put("/me/stock-detail-preferences", requireAuth, async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(updateStockDetailPreferencesSchema, req.body);
    const stockDetailPreferences = await updateStockDetailPreferences(
      firebaseUid,
      body.mode,
      body.visibleCardIds,
      deps,
    );
    res.json({ stockDetailPreferences });
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
