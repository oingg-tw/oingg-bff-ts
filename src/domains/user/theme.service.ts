import { AppError } from "../../shared/errorHandler.js";
import { findThemePreference, upsertThemePreference } from "./theme.repository.js";
import type { ThemeAccentColor, ThemeMode, ThemePreference, ThemePreferenceUpdate } from "./theme.types.js";

const VALID_MODES: ThemeMode[] = ["LIGHT", "DARK", "SYSTEM"];
const VALID_ACCENT_COLORS: ThemeAccentColor[] = ["BLUE", "GREEN", "PURPLE", "ORANGE", "RED", "TEAL"];

/**
 * Out-of-the-box theme for users who haven't picked one yet — a plain code constant, resolved live
 * against whatever a user's row has (or doesn't have) rather than materialized into a per-user DB row
 * (see UserThemePreference's docstring for why). Changing this changes the default for every user who
 * hasn't explicitly overridden it, immediately, no data migration needed.
 */
export const SYSTEM_DEFAULT_THEME: ThemePreference = { mode: "SYSTEM", accentColor: "BLUE" };

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

export async function getThemePreference(firebaseUid: string): Promise<ThemePreference> {
  const row = await findThemePreference(firebaseUid);
  return {
    mode: row?.mode ?? SYSTEM_DEFAULT_THEME.mode,
    accentColor: row?.accentColor ?? SYSTEM_DEFAULT_THEME.accentColor,
  };
}

export async function updateThemePreference(
  firebaseUid: string,
  update: ThemePreferenceUpdate,
): Promise<ThemePreference> {
  if (update.mode === undefined && update.accentColor === undefined) {
    throw new AppError('At least one of "mode" or "accentColor" must be provided', 400);
  }
  if (update.mode !== undefined) {
    assertValidMode(update.mode);
  }
  if (update.accentColor !== undefined) {
    assertValidAccentColor(update.accentColor);
  }

  const row = await upsertThemePreference(firebaseUid, update);
  return {
    mode: row.mode ?? SYSTEM_DEFAULT_THEME.mode,
    accentColor: row.accentColor ?? SYSTEM_DEFAULT_THEME.accentColor,
  };
}
