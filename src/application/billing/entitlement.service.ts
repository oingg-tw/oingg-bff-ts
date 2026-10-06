import { BILLING_PAID_UID_ALLOWLIST, REVERSE_TRIAL_DAYS, REVERSE_TRIAL_TIER } from "@/shared/env.js";
import type { AppDeps } from "@/application/deps.js";
import type { Entitlement } from "@/application/billing/billing.types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Both ports, because the ladder reads both tables: the Subscription row for a paid grant, and the User
 * row's `createdAt` for the reverse trial. `user` is the same UserPort the user slice uses — billing
 * gets no private door into that table (the repository's own named exports were withdrawn once this
 * file stopped importing them).
 */
export type EntitlementDeps = Pick<AppDeps, "subscriptions" | "user">;

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
 * The single answer to "what is this user entitled to". Everything that gates on payment goes through
 * here rather than reading the Subscription table directly, so the Phase 0 allowlist has exactly one
 * place to live and one place to be deleted from once NewebPay is wired.
 *
 * Precedence is subscription → trial → allowlist → free. A paying user must never be demoted by a
 * trial that expired while they were subscribed.
 *
 * `now` is an explicit parameter rather than a defaulted one: `deps` has to be last (every use case in
 * this codebase reads that way), and a defaulted parameter in front of a required one can't actually be
 * omitted. Passing the clock in was always the point anyway — every branch below is a date comparison,
 * and a hidden `new Date()` is the kind of dependency that makes a paywall rule untestable.
 *
 * **What this may be used for is legally constrained**: breadth, history depth and export/alerts only.
 * It must never reach the stock-detail assembly path — see quota.ts.
 */
export async function getEntitlement(
  firebaseUid: string,
  now: Date,
  deps: EntitlementDeps,
): Promise<Entitlement> {
  const subscription = await deps.subscriptions.find(firebaseUid);
  if (subscription && isWithinPaidPeriod(subscription.status, subscription.currentPeriodEnd, now)) {
    return {
      // 只有一個付費層級（2026-10-06 拿掉 ADVISOR），所以任何 plan 字串（pro-monthly、pro-annual……）
      // 都是 PRO。哪天再有第二個付費層級，在這裡依 plan 前綴分流。
      tier: "PRO",
      source: "subscription",
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEndsAt: null,
      renewalMode: subscription.renewalMode,
    };
  }

  // Reverse trial: full access for the first N days after signup, no card, no row anywhere — it's
  // derived from the user's own createdAt. Expiry is a smooth downgrade: the user keeps everything they
  // created, they just stop being able to add more (quota.ts).
  //
  // 沒有 User 列就在這裡建（2026-10-06）：之前只有 GET /users/me 會建，而前端從來沒呼叫過它，所以沒有
  // 任何人拿到過試用。試用從第一次查方案起算——每個需要判斷方案的請求都會經過這裡。
  const user = (await deps.user.find(firebaseUid)) ?? (await deps.user.ensureExists(firebaseUid));
  const trialEnds = new Date(new Date(user.createdAt).getTime() + REVERSE_TRIAL_DAYS * DAY_MS);
  if (trialEnds.getTime() > now.getTime()) {
    return {
      tier: REVERSE_TRIAL_TIER,
      source: "trial",
      status: null,
      currentPeriodEnd: null,
      // A trial has nothing to renew: it ends by the calendar, not by a payment agreement.
      trialEndsAt: trialEnds.toISOString(),
      renewalMode: null,
    };
  }

  if (BILLING_PAID_UID_ALLOWLIST.includes(firebaseUid)) {
    return { tier: "PRO", source: "allowlist", status: null, currentPeriodEnd: null, trialEndsAt: null, renewalMode: null };
  }

  return {
    tier: "FREE",
    source: subscription ? "subscription" : "none",
    status: subscription?.status ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    trialEndsAt: null,
    // Kept on a lapsed row: "it expired and would not have renewed itself" is what tells the UI to
    // offer a renewal rather than wait for a charge that is never coming.
    renewalMode: subscription?.renewalMode ?? null,
  };
}
