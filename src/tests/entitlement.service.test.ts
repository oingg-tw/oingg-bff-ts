import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/prisma/repositories/billing.repository.js", () => ({
  findSubscriptionByFirebaseUid: vi.fn(),
}));

vi.mock("@/infrastructure/prisma/repositories/user.repository.js", () => ({
  findUserByFirebaseUid: vi.fn(),
  ensureUserProvisioned: vi.fn(),
}));

vi.mock("@/shared/env.js", () => ({
  BILLING_PAID_UID_ALLOWLIST: ["allowlisted-uid"],
  REVERSE_TRIAL_DAYS: 14,
  REVERSE_TRIAL_TIER: "PRO",
}));

import { findSubscriptionByFirebaseUid } from "@/infrastructure/prisma/repositories/billing.repository.js";
import { findUserByFirebaseUid } from "@/infrastructure/prisma/repositories/user.repository.js";
import { getEntitlement } from "@/application/billing/entitlement.service.js";

const NOW = new Date("2026-09-23T00:00:00.000Z");

/** Signed up long enough ago that the reverse trial can't be what's granting access. */
const OLD_USER = { id: "u1", firebaseUid: "uid", email: null, displayName: null, createdAt: "2026-01-01T00:00:00.000Z" };

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    firebaseUid: "uid",
    status: "ACTIVE",
    plan: "pro-monthly",
    currentPeriodEnd: "2026-10-23T00:00:00.000Z",
    provider: "NEWEBPAY",
    providerPeriodNo: "P123",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(findSubscriptionByFirebaseUid).mockResolvedValue(null);
  vi.mocked(findUserByFirebaseUid).mockResolvedValue(OLD_USER);
});

describe("getEntitlement — subscriptions", () => {
  it("grants the plan's tier while the paid period is still running", async () => {
    vi.mocked(findSubscriptionByFirebaseUid).mockResolvedValue(subscription() as never);

    const result = await getEntitlement("uid", NOW);

    expect(result).toEqual({
      tier: "PRO",
      source: "subscription",
      status: "ACTIVE",
      currentPeriodEnd: "2026-10-23T00:00:00.000Z",
      trialEndsAt: null,
    });
  });

  it("reads ADVISOR from the plan identifier so a new price point needs no migration", async () => {
    vi.mocked(findSubscriptionByFirebaseUid).mockResolvedValue(subscription({ plan: "advisor-annual" }) as never);

    await expect(getEntitlement("uid", NOW)).resolves.toMatchObject({ tier: "ADVISOR" });
  });

  it("falls back to PRO for an unrecognised plan rather than granting the expensive tier", async () => {
    vi.mocked(findSubscriptionByFirebaseUid).mockResolvedValue(subscription({ plan: "something-new" }) as never);

    await expect(getEntitlement("uid", NOW)).resolves.toMatchObject({ tier: "PRO" });
  });

  // A cancellation shouldn't take away time the user already paid for.
  it("keeps access for a CANCELED subscription until its period actually ends", async () => {
    vi.mocked(findSubscriptionByFirebaseUid).mockResolvedValue(subscription({ status: "CANCELED" }) as never);

    await expect(getEntitlement("uid", NOW)).resolves.toMatchObject({ tier: "PRO", status: "CANCELED" });
  });

  // Fails closed: an ACTIVE row past its period means the renewal webhook never landed. The webhook
  // restores access the moment it arrives; failing open would hand out an unbounded free ride.
  it("drops an ACTIVE subscription whose period has already passed", async () => {
    vi.mocked(findSubscriptionByFirebaseUid).mockResolvedValue(
      subscription({ currentPeriodEnd: "2026-09-01T00:00:00.000Z" }) as never,
    );

    await expect(getEntitlement("uid", NOW)).resolves.toMatchObject({ tier: "FREE", source: "subscription" });
  });

  it("grants nothing on PAST_DUE", async () => {
    vi.mocked(findSubscriptionByFirebaseUid).mockResolvedValue(subscription({ status: "PAST_DUE" }) as never);

    await expect(getEntitlement("uid", NOW)).resolves.toMatchObject({ tier: "FREE" });
  });
});

describe("getEntitlement — reverse trial", () => {
  it("grants PRO for the first 14 days after signup, with no subscription row at all", async () => {
    vi.mocked(findUserByFirebaseUid).mockResolvedValue({ ...OLD_USER, createdAt: "2026-09-20T00:00:00.000Z" });

    const result = await getEntitlement("uid", NOW);

    expect(result).toEqual({
      tier: "PRO",
      source: "trial",
      status: null,
      currentPeriodEnd: null,
      trialEndsAt: "2026-10-04T00:00:00.000Z",
    });
  });

  it("expires to FREE on day 15 — a downgrade, not a lockout (nothing here deletes anything)", async () => {
    vi.mocked(findUserByFirebaseUid).mockResolvedValue({ ...OLD_USER, createdAt: "2026-09-08T00:00:00.000Z" });

    await expect(getEntitlement("uid", NOW)).resolves.toMatchObject({ tier: "FREE", trialEndsAt: null });
  });

  // Precedence matters: a subscriber whose trial lapsed while they were paying must not be demoted.
  it("prefers an active subscription over an expired trial", async () => {
    vi.mocked(findUserByFirebaseUid).mockResolvedValue({ ...OLD_USER, createdAt: "2026-01-01T00:00:00.000Z" });
    vi.mocked(findSubscriptionByFirebaseUid).mockResolvedValue(subscription() as never);

    await expect(getEntitlement("uid", NOW)).resolves.toMatchObject({ tier: "PRO", source: "subscription" });
  });

  it("treats a user with no row as FREE instead of throwing", async () => {
    vi.mocked(findUserByFirebaseUid).mockResolvedValue(null);

    await expect(getEntitlement("uid", NOW)).resolves.toMatchObject({ tier: "FREE", source: "none" });
  });
});

describe("getEntitlement — Phase 0 allowlist", () => {
  it("grants PRO and reports source:allowlist so a stray production entry is visible", async () => {
    const result = await getEntitlement("allowlisted-uid", NOW);

    expect(result).toMatchObject({ tier: "PRO", source: "allowlist" });
  });

  it("does not let the allowlist override a real subscription's tier", async () => {
    vi.mocked(findSubscriptionByFirebaseUid).mockResolvedValue(
      subscription({ firebaseUid: "allowlisted-uid", plan: "advisor-annual" }) as never,
    );

    await expect(getEntitlement("allowlisted-uid", NOW)).resolves.toMatchObject({
      tier: "ADVISOR",
      source: "subscription",
    });
  });
});
