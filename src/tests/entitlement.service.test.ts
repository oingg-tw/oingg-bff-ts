import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/env.js", () => ({
  BILLING_PAID_UID_ALLOWLIST: ["allowlisted-uid"],
  REVERSE_TRIAL_DAYS: 14,
  REVERSE_TRIAL_TIER: "PRO",
}));

import type { SubscriptionRecord } from "@/application/billing/billing.types.js";
import { getEntitlement } from "@/application/billing/entitlement.service.js";
import { OLD_USER, fakeSubscriptions, fakeUserPort } from "@/tests/fakes/billing.js";

const NOW = new Date("2026-09-23T00:00:00.000Z");

function subscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    firebaseUid: "uid",
    status: "ACTIVE",
    plan: "pro-monthly",
    currentPeriodEnd: "2026-10-23T00:00:00.000Z",
    provider: "NEWEBPAY",
    providerPeriodNo: "P123",
    renewalMode: "AUTOMATIC" as const,
    ...overrides,
  };
}

/**
 * Fake ports instead of `vi.mock` on the two repository modules. Both tables are now reached through
 * SubscriptionsPort/UserPort, so these tests state the contract the paywall depends on rather than the
 * shape of whatever is storing it — and `user` being the same UserPort the user slice uses is the point
 * of the change: billing no longer has a private door into the User table.
 */
function deps(overrides: { subscription?: SubscriptionRecord | null; user?: typeof OLD_USER | null } = {}) {
  return {
    subscriptions: fakeSubscriptions(
      overrides.subscription === undefined
        ? {}
        : { find: vi.fn().mockResolvedValue(overrides.subscription) },
    ),
    user: fakeUserPort(overrides.user === undefined ? {} : { find: vi.fn().mockResolvedValue(overrides.user) }),
  };
}

describe("getEntitlement — subscriptions", () => {
  it("grants the plan's tier while the paid period is still running", async () => {
    const result = await getEntitlement("uid", NOW, deps({ subscription: subscription() }));

    expect(result).toEqual({
      tier: "PRO",
      source: "subscription",
      status: "ACTIVE",
      currentPeriodEnd: "2026-10-23T00:00:00.000Z",
      trialEndsAt: null,
      renewalMode: "AUTOMATIC",
    });
  });

  // 只有一個付費層級（2026-10-06 拿掉 ADVISOR），任何 plan 字串都是 PRO——新價格點不必改程式。
  // 2026-10-06：前端從來沒呼叫過 GET /users/me，所以沒有 User 列、也就沒有人拿到過試用。現在第一次查方案
  // 就建立那一列，試用從那一刻起算。
  it("creates the missing User row and starts the trial from it", async () => {
    const fresh = { ...OLD_USER, createdAt: NOW.toISOString() };
    const d = deps();
    vi.mocked(d.user.find).mockResolvedValue(null);
    vi.mocked(d.user.ensureExists).mockResolvedValue(fresh);

    const result = await getEntitlement("uid", NOW, d);

    expect(d.user.ensureExists).toHaveBeenCalledWith("uid");
    expect(result).toMatchObject({ tier: "PRO", source: "trial" });
  });

  it("grants PRO for any plan identifier", async () => {
    const result = getEntitlement("uid", NOW, deps({ subscription: subscription({ plan: "something-new" }) }));

    await expect(result).resolves.toMatchObject({ tier: "PRO" });
  });

  // A cancellation shouldn't take away time the user already paid for.
  it("keeps access for a CANCELED subscription until its period actually ends", async () => {
    const result = getEntitlement("uid", NOW, deps({ subscription: subscription({ status: "CANCELED" }) }));

    await expect(result).resolves.toMatchObject({ tier: "PRO", status: "CANCELED" });
  });

  // Fails closed: an ACTIVE row past its period means the renewal webhook never landed. The webhook
  // restores access the moment it arrives; failing open would hand out an unbounded free ride.
  it("drops an ACTIVE subscription whose period has already passed", async () => {
    const result = getEntitlement(
      "uid",
      NOW,
      deps({ subscription: subscription({ currentPeriodEnd: "2026-09-01T00:00:00.000Z" }) }),
    );

    await expect(result).resolves.toMatchObject({ tier: "FREE", source: "subscription" });
  });

  it("grants nothing on PAST_DUE", async () => {
    const result = getEntitlement("uid", NOW, deps({ subscription: subscription({ status: "PAST_DUE" }) }));

    await expect(result).resolves.toMatchObject({ tier: "FREE" });
  });
});

describe("getEntitlement — reverse trial", () => {
  it("grants PRO for the first 14 days after signup, with no subscription row at all", async () => {
    const result = await getEntitlement(
      "uid",
      NOW,
      deps({ user: { ...OLD_USER, createdAt: "2026-09-20T00:00:00.000Z" } }),
    );

    expect(result).toEqual({
      tier: "PRO",
      source: "trial",
      status: null,
      currentPeriodEnd: null,
      trialEndsAt: "2026-10-04T00:00:00.000Z",
      renewalMode: null,
    });
  });

  it("expires to FREE on day 15 — a downgrade, not a lockout (nothing here deletes anything)", async () => {
    const result = getEntitlement(
      "uid",
      NOW,
      deps({ user: { ...OLD_USER, createdAt: "2026-09-08T00:00:00.000Z" } }),
    );

    await expect(result).resolves.toMatchObject({ tier: "FREE", trialEndsAt: null });
  });

  // Precedence matters: a subscriber whose trial lapsed while they were paying must not be demoted.
  it("prefers an active subscription over an expired trial", async () => {
    const result = getEntitlement(
      "uid",
      NOW,
      deps({ subscription: subscription(), user: { ...OLD_USER, createdAt: "2026-01-01T00:00:00.000Z" } }),
    );

    await expect(result).resolves.toMatchObject({ tier: "PRO", source: "subscription" });
  });

});

describe("getEntitlement — Phase 0 allowlist", () => {
  it("grants PRO and reports source:allowlist so a stray production entry is visible", async () => {
    const result = await getEntitlement("allowlisted-uid", NOW, deps());

    expect(result).toMatchObject({ tier: "PRO", source: "allowlist" });
  });

  it("does not let the allowlist override a real subscription's tier", async () => {
    const result = getEntitlement(
      "allowlisted-uid",
      NOW,
      deps({ subscription: subscription({ firebaseUid: "allowlisted-uid", plan: "pro-annual" }) }),
    );

    await expect(result).resolves.toMatchObject({ tier: "PRO", source: "subscription" });
  });
});

describe("getEntitlement — renewalMode", () => {
  // The point of the field: currentPeriodEnd says WHEN access ends, renewalMode says whether anything
  // will stop that happening. A MANUAL subscriber shown "next charge on <date>" loses access with no
  // warning, because no charge is coming.
  it("reports AUTOMATIC for a recurring card subscription", async () => {
    const result = await getEntitlement("uid", NOW, deps({ subscription: subscription({ renewalMode: "AUTOMATIC" }) }));

    expect(result).toMatchObject({ tier: "PRO", renewalMode: "AUTOMATIC" });
  });

  // ATM / convenience-store annual payments have no agreement on the provider side at all.
  it("reports MANUAL for a one-off annual payment, which has no provider period number either", async () => {
    const result = await getEntitlement(
      "uid",
      NOW,
      deps({ subscription: subscription({ renewalMode: "MANUAL", providerPeriodNo: null }) }),
    );

    expect(result).toMatchObject({ tier: "PRO", renewalMode: "MANUAL" });
  });

  // Kept on a lapsed row so the UI can offer a renewal instead of waiting for a charge that will
  // never arrive.
  it("keeps the mode on an expired subscription that has already dropped to FREE", async () => {
    const result = await getEntitlement(
      "uid",
      NOW,
      deps({ subscription: subscription({ renewalMode: "MANUAL", currentPeriodEnd: "2026-09-01T00:00:00.000Z" }) }),
    );

    expect(result).toMatchObject({ tier: "FREE", renewalMode: "MANUAL" });
  });

  it("is null during the trial, which ends by the calendar rather than by a payment agreement", async () => {
    const result = await getEntitlement(
      "uid",
      NOW,
      deps({ subscription: null, user: { ...OLD_USER, createdAt: "2026-09-20T00:00:00.000Z" } }),
    );

    expect(result).toMatchObject({ source: "trial", renewalMode: null });
  });

  it("is null for a free user with no subscription row", async () => {
    const result = await getEntitlement("uid", NOW, deps({ subscription: null }));

    expect(result).toMatchObject({ tier: "FREE", renewalMode: null });
  });
});
