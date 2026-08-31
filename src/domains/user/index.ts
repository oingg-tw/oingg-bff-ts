export { userRouter } from "./user.routes.js";
export {
  getThemePreference,
  updateThemeMode,
  updateThemeAccentColor,
  updateMarketColorConvention,
  SYSTEM_DEFAULT_THEME,
} from "./theme.service.js";
export type { MarketColorConvention, ThemeAccentColor, ThemeMode, ThemePreference } from "./theme.types.js";
export { findUserByFirebaseUid, getUserByFirebaseUidOrThrow } from "./user.service.js";
export type { UserProfile } from "./user.types.js";
