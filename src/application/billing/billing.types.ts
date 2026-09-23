import type { BillingProvider, SubscriptionStatus } from "@/generated/prisma/client.js";

export type { BillingProvider, SubscriptionStatus };

/**
 * The three-step ladder. Deliberately NOT a Prisma enum and NOT tied to a price: prices are expected to
 * move (a Van Westendorp study is still pending), and this service isn't the source of truth for the
 * price list — a plan identifier string on the Subscription row is, so a new price point needs no
 * migration here.
 */
export type BillingTier = "FREE" | "PRO" | "ADVISOR";

/**
 * Every metered resource. Adding one here forces the tier table to cover it for all three tiers
 * (Record, not Partial), so a new quota can't silently default to "unlimited for everyone".
 */
export type QuotaResource = "watchlistItems" | "screenerPresets" | "columnPresets";

/**
 * Where a tier came from, reported to the caller rather than hidden — a stray production allowlist
 * entry should be visible instead of silently granting access.
 * - `trial`: the 14-day reverse trial, derived from the user's own signup date, no card, no row.
 * - `allowlist`: the Phase 0 stand-in for a payment provider; removed once NewebPay is wired.
 */
export type EntitlementSource = "subscription" | "trial" | "allowlist" | "none";

export interface Entitlement {
  tier: BillingTier;
  source: EntitlementSource;
  /** Null unless a real Subscription row exists (trial and allowlist grants have no billing status). */
  status: SubscriptionStatus | null;
  /** ISO date-time the current paid period ends — null when there's no subscription row. */
  currentPeriodEnd: string | null;
  /** ISO date-time the reverse trial ends; present whenever the user is still inside it. */
  trialEndsAt: string | null;
}

export interface SubscriptionRecord {
  firebaseUid: string;
  status: SubscriptionStatus;
  plan: string;
  currentPeriodEnd: string;
  provider: BillingProvider;
  providerPeriodNo: string | null;
}
