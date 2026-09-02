export { userRouter } from "@/domains/user/user.routes.js";
export {
  getThemePreference,
  updateThemeMode,
  updateThemeAccentColor,
  updateMarketColorConvention,
  updateIsFullWidth,
  SYSTEM_DEFAULT_THEME,
} from "@/domains/user/theme.service.js";
export type { MarketColorConvention, ThemeAccentColor, ThemeMode, ThemePreference } from "@/domains/user/theme.types.js";
export { findUserByFirebaseUid, getUserByFirebaseUidOrThrow } from "@/domains/user/user.service.js";
export type { UserProfile } from "@/domains/user/user.types.js";
export {
  getDisplaySettings,
  updateShowAsOfDate,
  SYSTEM_DEFAULT_DISPLAY_SETTINGS,
} from "@/domains/user/screenerDisplaySettings.service.js";
export type { ScreenerDisplaySettings } from "@/domains/user/screenerDisplaySettings.types.js";
export {
  getDashboardCardSettings,
  updateDashboardCardSettings,
} from "@/domains/user/dashboardCardSettings.service.js";
export type { DashboardCardSettings } from "@/domains/user/dashboardCardSettings.types.js";
