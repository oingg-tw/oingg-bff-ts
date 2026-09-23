import { AppError } from "@/shared/errorHandler.js";
import { ensureUserProvisioned, findUserByFirebaseUid } from "@/domainBusiness/user/user.repository.js";
import type { UserProfile } from "@/domainBusiness/user/user.types.js";
import type { DecodedIdToken } from "firebase-admin/auth";

export { ensureUserProvisioned, findUserByFirebaseUid };

export async function getUserByFirebaseUidOrThrow(firebaseUid: string): Promise<UserProfile> {
  const user = await findUserByFirebaseUid(firebaseUid);
  if (!user) {
    throw new AppError(`No user found for firebase uid "${firebaseUid}"`, 404);
  }
  return user;
}

/**
 * Resolves the caller's profile, creating the row on first contact instead of 404ing.
 *
 * Firebase has already vouched for this person by the time we get here, so "authenticated but no row"
 * was never a meaningful error — it just meant we'd never seen them before. It now matters
 * materially: `createdAt` anchors the 14-day reverse trial, so a missing row would mean no trial.
 * Identity fields come from the verified token, never from the request body.
 */
export async function getOrCreateUserFromToken(token: DecodedIdToken): Promise<UserProfile> {
  return ensureUserProvisioned(token.uid, token.email ?? null, token.name ?? null);
}
