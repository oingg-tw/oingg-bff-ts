import { AppError } from "@/shared/errorHandler.js";
import {
  findDashboardCardSettings,
  upsertDashboardCardSettings,
} from "@/domains/user/dashboardCardSettings.repository.js";
import type { DashboardCardSettings } from "@/domains/user/dashboardCardSettings.types.js";

/**
 * `visibleCardIds: null` means "no preference saved yet" — distinct from an empty array, which would
 * mean the user explicitly hid every card. Unlike SYSTEM_DEFAULT_THEME, bff-ts doesn't resolve this to a
 * hardcoded default list: card ids are a frontend-owned, growing set (see oingg-web-nuxt's
 * useDashboardCards.ts), so only the frontend actually knows what "show everything" currently means.
 */
export async function getDashboardCardSettings(firebaseUid: string): Promise<DashboardCardSettings> {
  const row = await findDashboardCardSettings(firebaseUid);
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
): Promise<DashboardCardSettings> {
  assertValidVisibleCardIds(visibleCardIds);
  const row = await upsertDashboardCardSettings(firebaseUid, visibleCardIds);
  return { visibleCardIds: row.visibleCardIds };
}
