import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import type { DashboardCardSettings } from "@/application/user/dashboardCardSettings.types.js";

export type DashboardCardSettingsDeps = Pick<AppDeps, "userPreferences">;

/**
 * `visibleCardIds: null` means "no preference saved yet" — distinct from an empty array, which would
 * mean the user explicitly hid every card. Unlike SYSTEM_DEFAULT_THEME, bff-ts doesn't resolve this to a
 * hardcoded default list: card ids are a frontend-owned, growing set (see oingg-web-nuxt's
 * useDashboardCards.ts), so only the frontend actually knows what "show everything" currently means.
 */
export async function getDashboardCardSettings(
  firebaseUid: string,
  deps: DashboardCardSettingsDeps,
): Promise<DashboardCardSettings> {
  const row = await deps.userPreferences.getDashboardCards(firebaseUid);
  return { visibleCardIds: row?.visibleCardIds ?? null };
}

function assertValidVisibleCardIds(visibleCardIds: unknown): asserts visibleCardIds is string[] {
  if (!Array.isArray(visibleCardIds) || !visibleCardIds.every((id) => typeof id === "string")) {
    throw new AppError('"visibleCardIds" must be an array of strings', 400);
  }
}

/** Card ids aren't validated against a known list — see getDashboardCardSettings's docstring for why. */
export async function updateDashboardCardSettings(
  firebaseUid: string,
  visibleCardIds: unknown,
  deps: DashboardCardSettingsDeps,
): Promise<DashboardCardSettings> {
  assertValidVisibleCardIds(visibleCardIds);
  const row = await deps.userPreferences.saveDashboardCards(firebaseUid, visibleCardIds);
  return { visibleCardIds: row.visibleCardIds };
}
