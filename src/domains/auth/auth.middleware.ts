import type { NextFunction, Response } from "ultimate-express";
import { getFirebaseAuth } from "../../adapters/firebase/index.js";
import { AppError } from "../../shared/errorHandler.js";
import type { AuthenticatedRequest } from "./auth.types.js";

const BEARER_PREFIX = "Bearer ";

/**
 * Verifies the Firebase ID token in the Authorization header and attaches
 * the decoded token to `req.user`. Rejects the request with 401 otherwise.
 */
export async function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith(BEARER_PREFIX)) {
    next(new AppError("Missing or malformed Authorization header", 401));
    return;
  }

  const idToken = authHeader.slice(BEARER_PREFIX.length);

  try {
    req.user = await getFirebaseAuth().verifyIdToken(idToken);
    next();
  } catch (error) {
    next(new AppError("Invalid or expired authentication token", 401, error instanceof Error ? error.message : undefined));
  }
}
