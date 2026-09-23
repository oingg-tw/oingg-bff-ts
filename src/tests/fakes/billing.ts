import { vi } from "vitest";
import type { SubscriptionsPort } from "@/application/ports/subscriptions.js";
import type { UserPort } from "@/application/ports/user.js";

/**
 * Fakes for the two ports the entitlement ladder reads. Shared by entitlement.service.test.ts and
 * quota.middleware.test.ts rather than written twice — the quota guard asks the same question the
 * entitlement service answers, so both tests need the same two ports stood up.
 *
 * Typed as the ports on purpose: adding a method to either breaks this file at compile time instead of
 * letting the tests pass against a shape that no longer exists.
 */

/** Signed up long enough ago that the reverse trial can't be what's granting access. */
export const OLD_USER = {
  id: "u1",
  firebaseUid: "uid",
  email: null,
  displayName: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** Defaults to "there is no subscription row" — the state every non-paying caller is in. */
export function fakeSubscriptions(overrides: Partial<SubscriptionsPort> = {}): SubscriptionsPort {
  return {
    find: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

/** Defaults to a user whose trial is long over, so a test that says nothing about time gets FREE. */
export function fakeUserPort(overrides: Partial<UserPort> = {}): UserPort {
  return {
    find: vi.fn().mockResolvedValue(OLD_USER),
    ensureProvisioned: vi.fn().mockResolvedValue(OLD_USER),
    ...overrides,
  };
}
