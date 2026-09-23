import type { Request } from "ultimate-express";
import type { VerifiedIdentity } from "@/application/user/user.types.js";

/**
 * A request that may carry an already-verified caller identity, attached by requireAuth/optionalAuth.
 *
 * This type used to live in application/auth/auth.types.ts, where it named two things the application
 * layer isn't allowed to know: ultimate-express's `Request` (the web framework) and firebase-admin's
 * `DecodedIdToken` (the identity provider). "A request object" is an HTTP-layer concept by definition,
 * so it belongs here; what survived into application is the part that isn't — TokenVerifierPort and
 * VerifiedIdentity.
 *
 * `user` is typed as VerifiedIdentity, a structural subset. At runtime it is still the whole verified
 * token object the provider returned (see infrastructure/firebase/tokenVerifier.ts), which is what
 * GET /auth/me serializes — narrowing the type does not narrow the value.
 *
 * Optional even behind requireAuth: Express-style middleware can't widen the handler's request type
 * for the routes mounted after it, so every handler still proves it for itself (the `requireUser`
 * helper each route module defines). That redundant 401 is the reason enforceQuota can't be mounted
 * without requireAuth and silently pass.
 */
export interface AuthenticatedRequest extends Request {
  user?: VerifiedIdentity;
}
