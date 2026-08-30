import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/user/user.repository.js", () => ({
  findUserByFirebaseUid: vi.fn(),
}));

import { findUserByFirebaseUid } from "../domains/user/user.repository.js";
import { getUserByFirebaseUidOrThrow } from "../domains/user/user.service.js";

const SAMPLE_USER = {
  id: "cabc123",
  firebaseUid: "uid1",
  email: "a@example.com",
  displayName: "Test User",
  createdAt: "2026-08-30T00:00:00.000Z",
};

// Regression test: findUserByFirebaseUid used to query queryNeon("main", ...) against a
// MAIN_DATABASE_URL Neon pool that was never configured in .env, so /users/me always threw
// "No Neon database pool registered for main" instead of resolving 200 or 404. It must read from
// this service's own Prisma-managed DB (via user.repository.ts) instead.
describe("getUserByFirebaseUidOrThrow", () => {
  beforeEach(() => {
    vi.mocked(findUserByFirebaseUid).mockReset();
  });

  it("throws a 404 when no row exists for this firebase uid (no signup flow creates one yet)", async () => {
    vi.mocked(findUserByFirebaseUid).mockResolvedValue(null);
    await expect(getUserByFirebaseUidOrThrow("uid1")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the profile row when one exists", async () => {
    vi.mocked(findUserByFirebaseUid).mockResolvedValue(SAMPLE_USER);
    await expect(getUserByFirebaseUidOrThrow("uid1")).resolves.toEqual(SAMPLE_USER);
  });
});
