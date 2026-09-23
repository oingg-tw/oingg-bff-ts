import { BILLING_PAID_UID_ALLOWLIST, REVERSE_TRIAL_DAYS, REVERSE_TRIAL_TIER } from "@/shared/env.js";
import { findSubscriptionByFirebaseUid } from "@/infrastructure/prisma/repositories/billing.repository.js";
import type { Entitlement } from "@/application/billing/billing.types.js";
import { findUserByFirebaseUid } from "@/infrastructure/prisma/repositories/user.repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A subscription grants its plan's tier while the period the user paid for is still running.
 *
 * Status alone isn't enough in either direction. A CANCELED subscription keeps access until the end of
 * the period already paid for — cutting it off at cancellation would be charging for time not served.
 * An ACTIVE row whose `currentPeriodEnd` has passed means the renewal webhook never arrived, and
 * failing closed there is the safe direction: the webhook restores access the moment it lands, whereas
 * failing open hands out an unbounded free ride on a silent billing outage.
 */
function isWithinPaidPeriod(status: string, currentPeriodEnd: string, now: Date): boolean {
  if (status !== "ACTIVE" && status !== "TRIALING" && status !== "CANCELED") {
    return false;
  }
  return new Date(currentPeriodEnd).getTime() > now.getTime();
}

/**
 * Maps a plan identifier to a tier. Kept as a prefix match so the price list can grow
 * ("pro-monthly", "pro-annual", "pro-annual-2027") without a code change here; an unrecognised plan
 * falls back to PRO rather than ADVISOR, because guessing low costs a support ticket while guessing
 * high gives away the expensive tier.
 */
function tierForPlan(plan: string): "PRO" | "ADVISOR" {
  return plan.toLowerCase().startsWith("advisor") ? "ADVISOR" : "PRO";
}

/**
 * The single answer to "what is this user entitled to". Everything that gates on payment goes through
 * here rather than reading the Subscription table directly, so the Phase 0 allowlist has exactly one
 * place to live and one place to be deleted from once NewebPay is wired.
 *
 * Precedence is subscription → trial → allowlist → free. A paying user must never be demoted by a
 * trial that expired while they were subscribed.
 *
 * **What this may be used for is legally constrained**: breadth, history depth and export/alerts only.
 * It must never reach the stock-detail assembly path — see quota.ts.
 */
export async function getEntitlement(firebaseUid: string, now: Date = new Date()): Promise<Entitlement> {
  const subscription = await findSubscriptionByFirebaseUid(firebaseUid);
  if (subscription && isWithinPaidPeriod(subscription.status, subscription.currentPeriodEnd, now)) {
    return {
      tier: tierForPlan(subscription.plan),
      source: "subscription",
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEndsAt: null,
    };
  }

  // Reverse trial: full access for the first N days after signup, no card, no row anywhere — it's
  // derived from the user's own createdAt, which is why provisioning that row matters (see
  // ensureUserProvisioned). Expiry is a smooth downgrade: the user keeps everything they created,
  // they just stop being able to add more (quota.ts).
  const user = await findUserByFirebaseUid(firebaseUid);
  if (user) {
    const trialEnds = new Date(new Date(user.createdAt).getTime() + REVERSE_TRIAL_DAYS * DAY_MS);
    if (trialEnds.getTime() > now.getTime()) {
      return {
        tier: REVERSE_TRIAL_TIER,
        source: "trial",
        status: null,
        currentPeriodEnd: null,
        trialEndsAt: trialEnds.toISOString(),
      };
    }
  }

  if (BILLING_PAID_UID_ALLOWLIST.includes(firebaseUid)) {
    return { tier: "PRO", source: "allowlist", status: null, currentPeriodEnd: null, trialEndsAt: null };
  }

  return {
    tier: "FREE",
    source: subscription ? "subscription" : "none",
    status: subscription?.status ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    trialEndsAt: null,
  };
}
