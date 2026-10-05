import type { BillingTier, Entitlement, QuotaResource } from "@/application/billing/billing.types.js";
import { getEntitlement, type EntitlementDeps } from "@/application/billing/entitlement.service.js";
import { quotaLimitFor } from "@/application/billing/quota.js";

const QUOTA_RESOURCES: readonly QuotaResource[] = ["watchlistItems", "screenerPresets", "columnPresets", "customHoldingColumns"];

/** Nothing of its own beyond what the entitlement ladder reads — the quota table is a local constant. */
export type BillingDeps = EntitlementDeps;

export interface EntitlementView extends Entitlement {
  /** The caller's own limits, `null` meaning unlimited — the single source the UI reads "3 of 3" from. */
  quotas: Record<QuotaResource, number | null>;
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
  const entitlement = await getEntitlement(firebaseUid, new Date(), deps);
  return { ...entitlement, quotas: quotasFor(entitlement.tier) };
}
