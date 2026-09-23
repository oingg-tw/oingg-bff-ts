import type { BillingTier, QuotaResource } from "@/domainBusiness/billing/billing.types.js";

/**
 * Per-tier limits, hardcoded as live constants rather than stored per user — a limit change should take
 * effect for everyone at once instead of requiring a backfill (same rule as SYSTEM_DEFAULT_THEME).
 * `null` means unlimited.
 *
 * Free's watchlist cap of 10 comes from the subscription spec; the two preset caps are provisional
 * placeholders. Prices live nowhere in this repo on purpose (they're still being validated) — only the
 * shape of what a tier may limit lives here.
 *
 * **What may appear in this table is constrained by 投信投顧法, not by product taste.** Only three
 * dimensions may ever differ between tiers:
 *   1. 查詢廣度   — how many things a user may save or track (this table)
 *   2. 歷史深度   — whether an extra data dimension exists at all (not the precision of a shown number)
 *   3. 匯出/推播  — CSV/Excel/PDF export, alerts, scheduled reports
 *
 * Anything that changes the *analysis a user sees about a company they already chose* is forbidden:
 * gating badge pass counts, valuation-river percentiles, the DuPont breakdown, provenance panels or
 * raw statements would make the price list itself evidence that what's sold is 分析意見 rather than
 * data access (第4條's 報酬 element; 第107條 is criminal). The 四方力道 first-instance judgment treated
 * "價金是否與分析功能掛鉤" as exactly that evidence.
 *
 * Two consequences that are easy to re-introduce by accident, so they're written down here:
 * - **Screener result lists are never truncated by tier.** The old "visible top rows" idea was killed
 *   on 2026-09-13: showing a free user only the top N reads as a platform-curated recommendation list,
 *   which is worse than the conversion it would buy. Same for the KY-stock section — a disclosure list
 *   must always be complete.
 * - **Downgrade makes things read-only, never deleted.** A user who drops to FREE with 30 watchlist
 *   items keeps all 30 visible; they simply can't add more. Destroying what a user built would both
 *   break the endowment effect the funnel relies on and look like punishment.
 */
const TIER_QUOTAS: Readonly<Record<BillingTier, Readonly<Record<QuotaResource, number | null>>>> = {
  FREE: {
    watchlistItems: 10,
    screenerPresets: 3,
    columnPresets: 3,
  },
  PRO: {
    watchlistItems: null,
    screenerPresets: null,
    columnPresets: null,
  },
  ADVISOR: {
    watchlistItems: null,
    screenerPresets: null,
    columnPresets: null,
  },
};

/** Human-readable resource names for the 403 message — the frontend keys off `code`/`details`, not this. */
export const QUOTA_RESOURCE_LABELS: Readonly<Record<QuotaResource, string>> = {
  watchlistItems: "watchlist items",
  screenerPresets: "saved screener presets",
  columnPresets: "saved column presets",
};

export function quotaLimitFor(resource: QuotaResource, tier: BillingTier): number | null {
  return TIER_QUOTAS[tier][resource];
}
