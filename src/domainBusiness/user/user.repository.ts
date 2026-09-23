import { getPrismaClient } from "@/adapters/neon/index.js";
import type { User as UserRow } from "@/generated/prisma/client.js";
import type { UserProfile } from "@/domainBusiness/user/user.types.js";

function toUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    firebaseUid: row.firebaseUid,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findUserByFirebaseUid(firebaseUid: string): Promise<UserProfile | null> {
  const prisma = getPrismaClient();
  const row = await prisma.user.findUnique({ where: { firebaseUid } });
  return row ? toUserProfile(row) : null;
}

/**
 * Creates the row on first sight of an authenticated user, and returns the existing one afterwards.
 *
 * Until 2026-09-23 nothing in this service ever created a User row, so a perfectly valid Firebase
 * caller got a 404 from GET /users/me forever. That was tolerable while the row held nothing but a
 * display name; it stops being tolerable now that `createdAt` is what the 14-day reverse trial is
 * measured from — a user with no row would have no trial start, i.e. no entitlement at all.
 *
 * `update` deliberately rewrites email/displayName: Firebase is the source of truth for both, and a
 * user who changes their email there should not keep a stale copy here. Nothing else on the row is
 * touched, so `createdAt` — the trial anchor — can never be reset by a later login.
 */
export async function ensureUserProvisioned(
  firebaseUid: string,
  email: string | null,
  displayName: string | null,
): Promise<UserProfile> {
  const prisma = getPrismaClient();
  const row = await prisma.user.upsert({
    where: { firebaseUid },
    update: { email, displayName },
    create: { firebaseUid, email, displayName },
  });
  return toUserProfile(row);
}
