import { AppError } from "@/shared/errorHandler.js";
import { findDisplaySettings, upsertDisplaySettings } from "@/domains/user/screenerDisplaySettings.repository.js";
import type { ScreenerDisplaySettings } from "@/domains/user/screenerDisplaySettings.types.js";

/**
 * Out-of-the-box screener display settings for users who haven't picked one yet — a plain code
 * constant, resolved live against whatever a user's row has (or doesn't have), never materialized into
 * a per-user DB row at creation time (see [[feedback_system_defaults_as_code]] memory / UserThemePreference's
 * docstring for why). Defaults to hidden: asOfDate is supplementary detail, not shown until a user opts in.
 */
export const SYSTEM_DEFAULT_DISPLAY_SETTINGS: ScreenerDisplaySettings = { showAsOfDate: false };

export async function getDisplaySettings(firebaseUid: string): Promise<ScreenerDisplaySettings> {
  const row = await findDisplaySettings(firebaseUid);
  return { showAsOfDate: row?.showAsOfDate ?? SYSTEM_DEFAULT_DISPLAY_SETTINGS.showAsOfDate };
}

export async function updateShowAsOfDate(
  firebaseUid: string,
  showAsOfDate: unknown,
): Promise<ScreenerDisplaySettings> {
  if (typeof showAsOfDate !== "boolean") {
    throw new AppError('"showAsOfDate" must be a boolean', 400);
  }
  const row = await upsertDisplaySettings(firebaseUid, showAsOfDate);
  return { showAsOfDate: row.showAsOfDate ?? SYSTEM_DEFAULT_DISPLAY_SETTINGS.showAsOfDate };
}
