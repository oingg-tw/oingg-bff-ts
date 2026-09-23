import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Response } from "ultimate-express";

vi.mock("@/domainBusiness/billing/entitlement.service.js", () => ({
  getEntitlement: vi.fn(),
}));

import { getEntitlement } from "@/domainBusiness/billing/entitlement.service.js";
import { QUOTA_EXCEEDED_CODE, enforceQuota } from "@/domainBusiness/billing/quota.middleware.js";
import type { AuthenticatedRequest } from "@/domainBusiness/auth/auth.types.js";
import type { AppError } from "@/shared/errorHandler.js";

function requestFor(uid: string | undefined): AuthenticatedRequest {
  return { user: uid ? { uid } : undefined } as AuthenticatedRequest;
}

function entitlement(tier: "FREE" | "PRO" | "ADVISOR") {
  return { tier, source: "none" as const, status: null, currentPeriodEnd: null, trialEndsAt: null };
}

beforeEach(() => {
  vi.mocked(getEntitlement).mockResolvedValue(entitlement("FREE"));
});

describe("enforceQuota", () => {
  it("allows the request when the caller is below their limit", async () => {
    const next = vi.fn();
    const count = vi.fn().mockResolvedValue(2);

    await enforceQuota("screenerPresets", count)(requestFor("uid"), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith();
  });

  it("rejects with a 403 carrying quota_exceeded once the limit is reached", async () => {
    const next = vi.fn();
    const count = vi.fn().mockResolvedValue(3); // FREE allows 3

    await enforceQuota("screenerPresets", count)(requestFor("uid"), {} as Response, next as NextFunction);

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

    await enforceQuota("screenerPresets", count)(requestFor("uid"), {} as Response, next as NextFunction);

    const error = next.mock.calls[0]?.[0] as AppError | undefined;
    expect(error?.statusCode).toBe(403);
  });

  it("skips the count entirely for an unlimited tier", async () => {
    vi.mocked(getEntitlement).mockResolvedValue(entitlement("PRO"));
    const next = vi.fn();
    const count = vi.fn();

    await enforceQuota("screenerPresets", count)(requestFor("uid"), {} as Response, next as NextFunction);

    expect(count).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it("401s when mounted without requireAuth in front of it", async () => {
    const next = vi.fn();

    await enforceQuota("screenerPresets", vi.fn())(requestFor(undefined), {} as Response, next as NextFunction);

    const error = next.mock.calls[0]?.[0] as AppError | undefined;
    expect(error?.statusCode).toBe(401);
  });

  it("forwards an unexpected failure instead of silently letting the request through", async () => {
    vi.mocked(getEntitlement).mockRejectedValue(new Error("db down"));
    const next = vi.fn();

    await enforceQuota("screenerPresets", vi.fn())(requestFor("uid"), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
