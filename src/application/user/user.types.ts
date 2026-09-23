/**
 * The identity fields this service reads off an already-verified Firebase ID token.
 *
 * Deliberately a structural subset rather than firebase-admin's `DecodedIdToken`: the application layer
 * must not name one identity provider's SDK (same rule that keeps Prisma out of it — see
 * .dependency-cruiser.cjs's application-only-domain). A real `DecodedIdToken` satisfies this shape, so
 * callers still hand over the verified token itself — never anything assembled from a request body.
 */
export interface VerifiedIdentity {
  uid: string;
  email?: string;
  name?: string;
}

export interface UserProfile {
  id: string;
  firebaseUid: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
}
