import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import type { UserProfile, VerifiedIdentity } from "@/application/user/user.types.js";

export type UserDeps = Pick<AppDeps, "user">;

export async function getUserByFirebaseUidOrThrow(firebaseUid: string, deps: UserDeps): Promise<UserProfile> {
  const user = await deps.user.find(firebaseUid);
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
 * Identity fields come from the verified token, never from the request body — which is why this takes
 * the token itself rather than a uid/email/displayName triple a route could assemble from anywhere.
 */
export async function getOrCreateUserFromToken(token: VerifiedIdentity, deps: UserDeps): Promise<UserProfile> {
  return deps.user.ensureProvisioned(token.uid, token.email ?? null, token.name ?? null);
}
