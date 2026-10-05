import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import { getEntitlement, type EntitlementDeps } from "@/application/billing/entitlement.service.js";
import { QUOTA_EXCEEDED_CODE, QUOTA_RESOURCE_LABELS, quotaLimitFor, wouldGrowPastQuota } from "@/application/billing/quota.js";
import type { HoldingColumn, HoldingColumnsPreferences } from "@/application/user/holdingColumns.types.js";

export type HoldingColumnsDeps = Pick<AppDeps, "userPreferences"> & EntitlementDeps;

export async function getHoldingColumns(firebaseUid: string, deps: HoldingColumnsDeps): Promise<HoldingColumnsPreferences> {
  return { columns: await deps.userPreferences.getHoldingColumns(firebaseUid) };
}

/**
 * 整份覆蓋，順序就是顯示順序（跟 stock-detail-preferences 同一個慣例）。形狀與長度由 route 的 zod schema
 * 驗；這裡只驗 schema 表達不了的兩件事：id 不重複，以及額度。
 *
 * **額度規則：不能比現在存的更多，但可以維持或減少。** 這不是 enforceQuota middleware 的「用滿就不能
 * 新增」：PUT 是整份取代，middleware 不知道新清單有幾欄。而直接拿「新長度 > 上限」來擋會違反
 * quota.ts 的原則「降級只變唯讀、永不刪除」——一個降級的使用者存著 5 欄、上限是 3，連調整順序或改一個
 * 公式都會被擋。所以只有在**超過上限、而且比目前已存的更多**時才回 403。
 */
export async function updateHoldingColumns(
  firebaseUid: string,
  columns: HoldingColumn[],
  deps: HoldingColumnsDeps,
): Promise<HoldingColumnsPreferences> {
  const seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.id)) {
      throw new AppError(`Duplicate column id "${column.id}"`, 400);
    }
    seen.add(column.id);
  }

  const entitlement = await getEntitlement(firebaseUid, new Date(), deps);
  const limit = quotaLimitFor("customHoldingColumns", entitlement.tier);
  if (limit !== null && columns.length > limit) {
    const current = (await deps.userPreferences.getHoldingColumns(firebaseUid))?.length ?? 0;
    if (wouldGrowPastQuota(columns.length, current, limit)) {
      throw new AppError(
        `Your plan allows ${limit} ${QUOTA_RESOURCE_LABELS.customHoldingColumns}; you're saving ${columns.length}.`,
        403,
        { resource: "customHoldingColumns", limit, used: current, tier: entitlement.tier },
        QUOTA_EXCEEDED_CODE,
      );
    }
  }

  return { columns: await deps.userPreferences.saveHoldingColumns(firebaseUid, columns) };
}
