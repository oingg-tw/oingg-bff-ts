import { describe, expect, it, vi } from "vitest";
import type { UserPort } from "@/application/ports/user.js";
import { getOrCreateUserFromToken, getUserByFirebaseUidOrThrow } from "@/application/user/user.service.js";

const SAMPLE_USER = {
  id: "cabc123",
  firebaseUid: "uid1",
  email: "a@example.com",
  displayName: "Test User",
  createdAt: "2026-08-30T00:00:00.000Z",
};

/**
 * A fake port instead of `vi.mock` on the repository module — the test states the contract the service
 * depends on, so it survives the storage behind it being rewritten, and adding a method to UserPort
 * breaks this file at compile time instead of at runtime.
 */
function fakeUser(overrides: Partial<UserPort> = {}): UserPort {
  return {
    find: vi.fn().mockResolvedValue(null),
    ensureProvisioned: vi.fn().mockResolvedValue(SAMPLE_USER),
    ensureExists: vi.fn().mockResolvedValue(SAMPLE_USER),
    ...overrides,
  };
}

// Regression test: findUserByFirebaseUid used to query queryNeon("main", ...) against a
// MAIN_DATABASE_URL Neon pool that was never configured in .env, so /users/me always threw
// "No Neon database pool registered for main" instead of resolving 200 or 404. Which database answers
// is now the adapter's business — the use case only knows the port.
describe("getUserByFirebaseUidOrThrow", () => {
  it("throws a 404 when no row exists for this firebase uid", async () => {
    const user = fakeUser();

    await expect(getUserByFirebaseUidOrThrow("uid1", { user })).rejects.toMatchObject({ statusCode: 404 });
    expect(user.find).toHaveBeenCalledWith("uid1");
  });

  it("returns the profile row when one exists", async () => {
    const user = fakeUser({ find: vi.fn().mockResolvedValue(SAMPLE_USER) });

    await expect(getUserByFirebaseUidOrThrow("uid1", { user })).resolves.toEqual(SAMPLE_USER);
  });
});

describe("getOrCreateUserFromToken", () => {
  // The identity written to storage must come from the verified token's own fields and nothing else —
  // this is what stops a request body from ever deciding who the caller is.
  it("provisions the row from the verified token's uid/email/name", async () => {
    const user = fakeUser();

    const profile = await getOrCreateUserFromToken(
      { uid: "uid1", email: "a@example.com", name: "Test User" },
      { user },
    );

    expect(user.ensureProvisioned).toHaveBeenCalledWith("uid1", "a@example.com", "Test User");
    expect(profile).toEqual(SAMPLE_USER);
  });

  // A Firebase token carries no email for some providers (phone/anonymous sign-in), and `name` only
  // once a display name exists. Both must land as null rather than undefined.
  it("passes null for identity fields the token doesn't carry", async () => {
    const user = fakeUser();

    await getOrCreateUserFromToken({ uid: "uid1" }, { user });

    expect(user.ensureProvisioned).toHaveBeenCalledWith("uid1", null, null);
  });
});
