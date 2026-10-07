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

  /**
   * watchlistItems 這一條單獨釘住，因為它跟另外兩個資源不是同一個量級的東西：FREE 的 10 檔是付費牆目前
   * 唯一真的在驅動付費的維度（見 application/billing/quota.ts 的長註解），而 2026-09-28 之前
   * `enforceQuota` 根本沒有掛在 watchlist 的路由上——帳面有上限、實際收無限多筆。
   *
   * **這個測試守的是數字與資源鍵，擋不住「又忘了掛上去」**（那要 route 層的測試，這個 repo 沒有那種慣例）。
   * 掛載本身是用臨時帳號實測驗的：FREE 帳號加到第 11 筆要拿到 403。
   */
  it("FREE 的觀察清單上限是 10，第 11 筆被擋下來並帶出 quota_exceeded", async () => {
    deps = { subscriptions: fakeSubscriptions(), user: fakeUserPort({ find: vi.fn().mockResolvedValue(OLD_USER) }) };
    const next = vi.fn();

    await enforceQuota("watchlistItems", vi.fn().mockResolvedValue(10), deps)(requestFor("uid"), {} as Response, next as NextFunction);

    const error = next.mock.calls[0]?.[0] as AppError | undefined;
    expect(error?.statusCode).toBe(403);
    expect(error?.code).toBe(QUOTA_EXCEEDED_CODE);
    // 放在 extensions 而不是 details：production 會拿掉 details，前端就顯示不出「已用 10/10」（2026-10-08 修正）。
    expect(error?.extensions).toMatchObject({ resource: "watchlistItems", limit: 10, used: 10, tier: "FREE" });
  });

  it("第 10 筆（還沒滿）放行", async () => {
    deps = { subscriptions: fakeSubscriptions(), user: fakeUserPort({ find: vi.fn().mockResolvedValue(OLD_USER) }) };
    const next = vi.fn();

    await enforceQuota("watchlistItems", vi.fn().mockResolvedValue(9), deps)(requestFor("uid"), {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith();
  });
});
