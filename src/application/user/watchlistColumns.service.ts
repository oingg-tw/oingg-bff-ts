import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import { getEntitlement, type EntitlementDeps } from "@/application/billing/entitlement.service.js";
import { QUOTA_EXCEEDED_CODE, QUOTA_RESOURCE_LABELS, quotaLimitFor, wouldGrowPastQuota } from "@/application/billing/quota.js";
import { resolveColumnFields, type ColumnFieldDeps } from "@/application/screener/columnField.js";
import type { WatchlistColumn, WatchlistColumnsPreferences } from "@/application/user/watchlistColumns.types.js";

export type WatchlistColumnsDeps = Pick<AppDeps, "userPreferences"> & EntitlementDeps & ColumnFieldDeps;

/**
 * 前端自己算、不屬於型錄也不是報價的兩個欄位（web-nuxt 2026-10-06 告知，兩個都在他們的預設清單裡）：
 * watchlist.change 是漲跌（股價 ÷ 前一日收盤），watchlist.exDividend 是下次除權息（來自 ex-dividend-notices）。
 * 只放行這兩個字面值，不放行整個 "watchlist." 前綴——否則任意字串都存得進來。新增合成欄位要來這裡加。
 */
const FRONTEND_FIELDS = new Set(["watchlist.change", "watchlist.exDividend"]);

export async function getWatchlistColumns(firebaseUid: string, deps: WatchlistColumnsDeps): Promise<WatchlistColumnsPreferences> {
  return { columns: await deps.userPreferences.getWatchlistColumns(firebaseUid) };
}

/**
 * 整份覆蓋，順序就是顯示順序。驗兩件 schema 表達不了的事：每個 field 都認得（型錄、報價特殊欄位或上面的
 * 合成欄位），以及額度——規則跟 updateHoldingColumns 一樣，只有在超過上限**而且**比目前已存的更多時才 403，
 * 降級的使用者仍然能調順序、刪欄位。重複的 field 不擋：同一個數字顯示兩次只是使用者自己的選擇。
 */
export async function updateWatchlistColumns(
  firebaseUid: string,
  columns: WatchlistColumn[],
  deps: WatchlistColumnsDeps,
): Promise<WatchlistColumnsPreferences> {
  const checkedFields = [...new Set(columns.map((column) => column.field).filter((field) => !FRONTEND_FIELDS.has(field)))];
  const resolved = await resolveColumnFields(checkedFields, deps);
  const unknown = checkedFields.find((field) => !resolved.get(field));
  if (unknown) {
    throw new AppError(`Unknown field "${unknown}"`, 400);
  }

  const entitlement = await getEntitlement(firebaseUid, new Date(), deps);
  const limit = quotaLimitFor("watchlistColumns", entitlement.tier);
  if (limit !== null && columns.length > limit) {
    const current = (await deps.userPreferences.getWatchlistColumns(firebaseUid))?.length ?? 0;
    if (wouldGrowPastQuota(columns.length, current, limit)) {
      throw new AppError(
        `Your plan allows ${limit} ${QUOTA_RESOURCE_LABELS.watchlistColumns}; you're saving ${columns.length}.`,
        403,
        undefined,
        QUOTA_EXCEEDED_CODE,
        { resource: "watchlistColumns", limit, used: current, tier: entitlement.tier },
      );
    }
  }

  return { columns: await deps.userPreferences.saveWatchlistColumns(firebaseUid, columns) };
}
