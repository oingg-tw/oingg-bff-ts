import type { AppDeps } from "@/application/deps.js";
import type { BillingTier, Entitlement, QuotaResource } from "@/application/billing/billing.types.js";
import { getEntitlement, type EntitlementDeps } from "@/application/billing/entitlement.service.js";
import { quotaLimitFor } from "@/application/billing/quota.js";

const QUOTA_RESOURCES: readonly QuotaResource[] = ["watchlistItems", "screenerPresets", "columnPresets", "customHoldingColumns", "watchlistColumns"];

/**
 * The entitlement ladder's ports, plus the ones that own each metered resource — `usage` counts them the
 * same way the quota checks do (quota.middleware.ts's counters and the two column services).
 */
export type BillingDeps = EntitlementDeps & Pick<AppDeps, "watchlist" | "screenerPresets" | "columnPresets" | "userPreferences">;

/** 對外公開的方案（2026-10-06 使用者決定只有這兩個；價格還沒定，所以這裡只有額度）。 */
const PLAN_TIERS: readonly BillingTier[] = ["FREE", "PRO"];

export interface EntitlementView extends Entitlement {
  /** The caller's own limits, `null` meaning unlimited — the single source the UI reads "3 of 3" from. */
  quotas: Record<QuotaResource, number | null>;
  /**
   * 目前用了多少（2026-10-06，web-nuxt 要在個人頁顯示「觀察清單 6／10 檔」）。算法跟額度檢查一致：
   * 三種存檔是列數，兩種欄位清單是存起來的陣列長度（沒存過算 0）。
   */
  usage: Record<QuotaResource, number>;
}

function quotasFor(tier: BillingTier): Record<QuotaResource, number | null> {
  return Object.fromEntries(QUOTA_RESOURCES.map((resource) => [resource, quotaLimitFor(resource, tier)])) as Record<
    QuotaResource,
    number | null
  >;
}

/**
 * What the frontend needs to render the paywall: the tier, why it holds, and the limits that go with
 * it. Returned together on purpose — a UI that fetched the tier and then hardcoded the limits would
 * silently disagree with the server the first time a limit changed.
 */
export async function getEntitlementView(
  firebaseUid: string,
  deps: BillingDeps,
): Promise<EntitlementView> {
  const [entitlement, usage] = await Promise.all([getEntitlement(firebaseUid, new Date(), deps), usageOf(firebaseUid, deps)]);
  return { ...entitlement, quotas: quotasFor(entitlement.tier), usage };
}

async function usageOf(firebaseUid: string, deps: BillingDeps): Promise<Record<QuotaResource, number>> {
  const [watchlistItems, screenerPresets, columnPresets, holdingColumns, watchlistColumns] = await Promise.all([
    deps.watchlist.count(firebaseUid),
    deps.screenerPresets.count(firebaseUid),
    deps.columnPresets.count(firebaseUid),
    deps.userPreferences.getHoldingColumns(firebaseUid),
    deps.userPreferences.getWatchlistColumns(firebaseUid),
  ]);
  return {
    watchlistItems,
    screenerPresets,
    columnPresets,
    customHoldingColumns: holdingColumns?.length ?? 0,
    watchlistColumns: watchlistColumns?.length ?? 0,
  };
}

/**
 * 公開的方案比較表（GET /billing/plans，不用登入）。只有額度、沒有價格——價格等 Van Westendorp 研究，
 * 而且本來就不歸這個服務管。前端拿這份畫比較表，不要自己寫死數字。
 */
export function getPlans(): { plans: { tier: BillingTier; quotas: Record<QuotaResource, number | null> }[] } {
  return { plans: PLAN_TIERS.map((tier) => ({ tier, quotas: quotasFor(tier) })) };
}
