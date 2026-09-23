import type { NextFunction, RequestHandler, Response } from "ultimate-express";
import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";

const BEARER_PREFIX = "Bearer ";

/**
 * 每一支掛了 requireAuth/optionalAuth 的路由工廠都要收這個，所以它獨立成一個型別而不是各自寫
 * `Pick<AppDeps, "tokenVerifier">`——路由的 deps 型別因此讀起來是「我這支要什麼 + 驗證」。
 */
export type AuthMiddlewareDeps = Pick<AppDeps, "tokenVerifier">;

/**
 * Shared by both middlewares below: everything after "a token was supplied" is identical, and the two
 * differ only in what a *missing* header means. Keeping the 401 path in one place is deliberate — the
 * error message and the `details` payload are part of the contract callers debug against.
 */
async function attachVerifiedUser(
  req: AuthenticatedRequest,
  idToken: string,
  next: NextFunction,
  deps: AuthMiddlewareDeps,
): Promise<void> {
  try {
    req.user = await deps.tokenVerifier.verifyIdToken(idToken);
    next();
  } catch (error) {
    next(new AppError("Invalid or expired authentication token", 401, error instanceof Error ? error.message : undefined));
  }
}

/**
 * Verifies the ID token in the Authorization header and attaches the verified identity to `req.user`.
 * Rejects the request with 401 otherwise.
 *
 * A factory rather than a plain middleware now: the verifier is injected instead of imported, so this
 * file no longer reaches into infrastructure for firebase-admin. Every route module that mounts it
 * takes `deps` already, so threading it through cost them one argument each and bought the http layer
 * its independence from the identity provider.
 */
export function createRequireAuth(deps: AuthMiddlewareDeps): RequestHandler {
  return async function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      next(new AppError("Missing or malformed Authorization header", 401));
      return;
    }

    await attachVerifiedUser(req, authHeader.slice(BEARER_PREFIX.length), next, deps);
  };
}

/**
 * Same token verification as createRequireAuth, but a missing Authorization header is allowed
 * through as an anonymous request (req.user left unset) instead of a 401 — for routes that
 * work for guests but personalize themselves when a valid token is present. A header that
 * IS present and invalid still rejects with 401 rather than silently downgrading to
 * anonymous, so a caller with an expired token gets a clear signal instead of quietly
 * losing their identity.
 */
export function createOptionalAuth(deps: AuthMiddlewareDeps): RequestHandler {
  return async function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      next();
      return;
    }

    await attachVerifiedUser(req, authHeader.slice(BEARER_PREFIX.length), next, deps);
  };
}
