import { AppError } from "@/shared/errorHandler.js";
import { findThemePreference, upsertThemePreference, type ThemePreferenceRow } from "@/domains/user/theme.repository.js";
import type { MarketColorConvention, ThemeAccentColor, ThemeMode, ThemePreference } from "@/domains/user/theme.types.js";

const VALID_MODES: ThemeMode[] = ["LIGHT", "DARK", "SYSTEM"];
const VALID_ACCENT_COLORS: ThemeAccentColor[] = ["BLUE", "GREEN", "PURPLE", "ORANGE", "RED", "TEAL", "GOLD"];
const VALID_MARKET_COLOR_CONVENTIONS: MarketColorConvention[] = ["ASIA", "WESTERN", "ACCESSIBLE"];

/**
 * Out-of-the-box theme for users who haven't picked one yet — a plain code constant, resolved live
 * against whatever a user's row has (or doesn't have) rather than materialized into a per-user DB row
 * (see UserThemePreference's docstring for why). Changing this changes the default for every user who
 * hasn't explicitly overridden it, immediately, no data migration needed — a user who already explicitly
 * chose BLUE keeps BLUE.
 *
 * accentColor defaults to GOLD — the app's actual brand color (logo/accent are gold), not just one of
 * seven equal options.
 *
 * marketColorConvention defaults to ASIA (red = up/gain, green = down/loss) since this platform is
 * TWSE/TPEx-focused — a Taiwan user who never touches this setting should see the convention they
 * already expect, not the US/Europe one.
 *
 * isFullWidth defaults to false as of 2026-09-01 — flipped from `true` because oingg-web-nuxt flipped
 * their own client-side default (the `layout-full-width` cookie) from full-width to centered, at the
 * product's request. Same reasoning as the original 2026-08-31 alignment in the other direction: a
 * freshly-synced account with no saved preference should land on the same layout a fresh/logged-out
 * device already shows — not jump from centered to full-width (or vice versa) the moment sign-in
 * resolves. Match live reality on whichever side currently owns the "true" default, don't guess.
 */
export const SYSTEM_DEFAULT_THEME: ThemePreference = {
  mode: "SYSTEM",
  accentColor: "GOLD",
  marketColorConvention: "ASIA",
  isFullWidth: false,
};

function assertValidMode(mode: unknown): asserts mode is ThemeMode {
  if (!VALID_MODES.includes(mode as ThemeMode)) {
    throw new AppError(`"mode" must be one of ${VALID_MODES.join(", ")}`, 400);
  }
}

function assertValidAccentColor(accentColor: unknown): asserts accentColor is ThemeAccentColor {
  if (!VALID_ACCENT_COLORS.includes(accentColor as ThemeAccentColor)) {
    throw new AppError(`"accentColor" must be one of ${VALID_ACCENT_COLORS.join(", ")}`, 400);
  }
}

function assertValidMarketColorConvention(
  marketColorConvention: unknown,
): asserts marketColorConvention is MarketColorConvention {
  if (!VALID_MARKET_COLOR_CONVENTIONS.includes(marketColorConvention as MarketColorConvention)) {
    throw new AppError(
      `"marketColorConvention" must be one of ${VALID_MARKET_COLOR_CONVENTIONS.join(", ")}`,
      400,
    );
  }
}

function toThemePreference(row: ThemePreferenceRow | null): ThemePreference {
  return {
    mode: row?.mode ?? SYSTEM_DEFAULT_THEME.mode,
    accentColor: row?.accentColor ?? SYSTEM_DEFAULT_THEME.accentColor,
    marketColorConvention: row?.marketColorConvention ?? SYSTEM_DEFAULT_THEME.marketColorConvention,
    isFullWidth: row?.isFullWidth ?? SYSTEM_DEFAULT_THEME.isFullWidth,
  };
}

export async function getThemePreference(firebaseUid: string): Promise<ThemePreference> {
  const row = await findThemePreference(firebaseUid);
  return toThemePreference(row);
}

/** 外觀模式 (light/dark/system) — its own endpoint, independent of accentColor/marketColorConvention. */
export async function updateThemeMode(firebaseUid: string, mode: unknown): Promise<ThemePreference> {
  assertValidMode(mode);
  const row = await upsertThemePreference(firebaseUid, { mode });
  return toThemePreference(row);
}

/** 主題色 (accent color) — its own endpoint, independent of mode/marketColorConvention. */
export async function updateThemeAccentColor(firebaseUid: string, accentColor: unknown): Promise<ThemePreference> {
  assertValidAccentColor(accentColor);
  const row = await upsertThemePreference(firebaseUid, { accentColor });
  return toThemePreference(row);
}

/** 漲跌顏色 (up/down price color convention) — its own endpoint, independent of mode/accentColor. */
export async function updateMarketColorConvention(
  firebaseUid: string,
  marketColorConvention: unknown,
): Promise<ThemePreference> {
  assertValidMarketColorConvention(marketColorConvention);
  const row = await upsertThemePreference(firebaseUid, { marketColorConvention });
  return toThemePreference(row);
}

/** 視覺滿版 (app-wide full-width layout) — its own endpoint, independent of the other theme fields. */
export async function updateIsFullWidth(firebaseUid: string, isFullWidth: unknown): Promise<ThemePreference> {
  if (typeof isFullWidth !== "boolean") {
    throw new AppError('"isFullWidth" must be a boolean', 400);
  }
  const row = await upsertThemePreference(firebaseUid, { isFullWidth });
  return toThemePreference(row);
}
