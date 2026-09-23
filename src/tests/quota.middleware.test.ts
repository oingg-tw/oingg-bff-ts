import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Response } from "ultimate-express";

vi.mock("@/shared/env.js", () => ({
  BILLING_PAID_UID_ALLOWLIST: [],
  REVERSE_TRIAL_DAYS: 14,
  REVERSE_TRIAL_TIER: "PRO",
}));

import { QUOTA_EXCEEDED_CODE, enforceQuota, type QuotaMiddlewareDeps } from "@/http/middleware/quota.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import type { AppError } from "@/domain/appError.js";
import { OLD_USER, fakeSubscriptions, fakeUserPort } from "@/tests/fakes/billing.js";

function requestFor(uid: string | undefined): AuthenticatedRequest {
  return { user: uid ? { uid } : undefined } as AuthenticatedRequest;
}

/**
 * The guard's deps are now the entitlement ladder's own ports, injected per route, instead of this
 * module importing the entitlement service's dependencies itself. So the tier a test wants is stated by
 * standing those ports up rather than by stubbing getEntitlement — which means these cases exercise the
 * real precedence rules too, not a mock's idea of them.
 *
 * Default: a long-signed-up user with no subscription row and an empty allowlist, i.e. FREE.
 */
let deps: QuotaMiddlewareDeps;

beforeEach(() => {
  deps = { subscriptions: fakeSubscriptions(), user: fakeUserPort() };
});

/** An active paid period — the only path to an unlimited tier that doesn't depend on the clock. */
function proSubscription() {
  return fakeSubscriptions({
    find: vi.fn().mockResolvedValue({
      firebaseUid: "uid",
      status: "ACTIVE",
      plan: "pro-monthly",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      provider: "NEWEBPAY",
      providerPeriodNo: "P123",
    }),
  });
}

describe("enforceQuota", () => {
  it("allows the request when the caller is below their limit", async () => {
    const next = vi.fn();
    const count = vi.fn().mockResolvedValue(2);

    await enforceQuota("screenerPresets", count, deps)(requestFor("uid"), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith();
  });

  it("rejects with a 403 carrying quota_exceeded once the limit is reached", async () => {
    const next = vi.fn();
    const count = vi.fn().mockResolvedValue(3); // FREE allows 3

    await enforceQuota("screenerPresets", count, deps)(requestFor("uid"), {} as Response, next as NextFunction);

    const error = next.mock.calls[0]?.[0] as AppError;
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe(QUOTA_EXCEEDED_CODE);
    expect(error.message).toContain("3");
  });

  // An over-quota user (e.g. one whose reverse trial just ended holding 10 presets) must still be
  // rejected rather than wrapping around, and — critically — nothing may be deleted to make room.
  it("still rejects when the caller is already over the limit after a downgrade", async () => {
    const next = vi.fn();
    const count = vi.fn().mockResolvedValue(10);

    await enforceQuota("screenerPresets", count, deps)(requestFor("uid"), {} as Response, next as NextFunction);

    const error = next.mock.calls[0]?.[0] as AppError | undefined;
    expect(error?.statusCode).toBe(403);
  });

  it("skips the count entirely for an unlimited tier", async () => {
    deps = { subscriptions: proSubscription(), user: fakeUserPort() };
    const next = vi.fn();
    const count = vi.fn();

    await enforceQuota("screenerPresets", count, deps)(requestFor("uid"), {} as Response, next as NextFunction);

    expect(count).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it("401s when mounted without requireAuth in front of it", async () => {
    const next = vi.fn();

    await enforceQuota("screenerPresets", vi.fn(), deps)(requestFor(undefined), {} as Response, next as NextFunction);

    const error = next.mock.calls[0]?.[0] as AppError | undefined;
    expect(error?.statusCode).toBe(401);
  });

  it("forwards an unexpected failure instead of silently letting the request through", async () => {
    deps = {
      subscriptions: fakeSubscriptions({ find: vi.fn().mockRejectedValue(new Error("db down")) }),
      user: fakeUserPort({ find: vi.fn().mockResolvedValue(OLD_USER) }),
    };
    const next = vi.fn();

    await enforceQuota("screenerPresets", vi.fn(), deps)(requestFor("uid"), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
