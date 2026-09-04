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

userRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const profile = await getUserByFirebaseUidOrThrow(requireUser(req));
  res.json({ user: profile });
});

userRouter.get("/me/theme", requireAuth, async (req: AuthenticatedRequest, res) => {
  const theme = await getThemePreference(requireUser(req));
  res.json({ theme });
});

userRouter.put("/me/theme/mode", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { mode?: unknown } | null;
  const theme = await updateThemeMode(firebaseUid, body?.mode);
  res.json({ theme });
});

userRouter.put("/me/theme/accent-color", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { accentColor?: unknown } | null;
  const theme = await updateThemeAccentColor(firebaseUid, body?.accentColor);
  res.json({ theme });
});

userRouter.put("/me/theme/market-color-convention", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { marketColorConvention?: unknown } | null;
  const theme = await updateMarketColorConvention(firebaseUid, body?.marketColorConvention);
  res.json({ theme });
});

userRouter.put("/me/theme/full-width", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { isFullWidth?: unknown } | null;
  const theme = await updateIsFullWidth(firebaseUid, body?.isFullWidth);
  res.json({ theme });
});

userRouter.get("/me/screener-display-settings", requireAuth, async (req: AuthenticatedRequest, res) => {
  const displaySettings = await getDisplaySettings(requireUser(req));
  res.json({ displaySettings });
});

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

userRouter.get("/me/dashboard-cards", requireAuth, async (req: AuthenticatedRequest, res) => {
  const dashboardCards = await getDashboardCardSettings(requireUser(req));
  res.json({ dashboardCards });
});

userRouter.put("/me/dashboard-cards", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { visibleCardIds?: unknown } | null;
  const dashboardCards = await updateDashboardCardSettings(firebaseUid, body?.visibleCardIds);
  res.json({ dashboardCards });
});
