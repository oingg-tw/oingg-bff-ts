import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { parseBody } from "@/shared/validation.js";
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
  const body = parseBody(updateThemeModeSchema, req.body);
  const theme = await updateThemeMode(firebaseUid, body.mode);
  res.json({ theme });
});

userRouter.put("/me/theme/accent-color", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(updateThemeAccentColorSchema, req.body);
  const theme = await updateThemeAccentColor(firebaseUid, body.accentColor);
  res.json({ theme });
});

userRouter.put("/me/theme/market-color-convention", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(updateMarketColorConventionSchema, req.body);
  const theme = await updateMarketColorConvention(firebaseUid, body.marketColorConvention);
  res.json({ theme });
});

userRouter.put("/me/theme/full-width", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(updateFullWidthSchema, req.body);
  const theme = await updateIsFullWidth(firebaseUid, body.isFullWidth);
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
    const body = parseBody(updateShowAsOfDateSchema, req.body);
    const displaySettings = await updateShowAsOfDate(firebaseUid, body.showAsOfDate);
    res.json({ displaySettings });
  },
);

userRouter.get("/me/dashboard-cards", requireAuth, async (req: AuthenticatedRequest, res) => {
  const dashboardCards = await getDashboardCardSettings(requireUser(req));
  res.json({ dashboardCards });
});

userRouter.put("/me/dashboard-cards", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(updateDashboardCardsSchema, req.body);
  const dashboardCards = await updateDashboardCardSettings(firebaseUid, body.visibleCardIds);
  res.json({ dashboardCards });
});
