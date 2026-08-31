import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "ultimate-express";
import { AppError } from "./errorHandler.js";
import { stripQuotes } from "./env.js";

function safeSecretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths instead of returning false — must check first, and
  // doing so before it runs is not itself a timing leak (the secret's length isn't the secret).
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Gate for server-to-server endpoints (no end user, no Firebase token) — a peer service authenticates
 * with a shared secret instead. Copied from oingg-twse-ts's requireTaskSecret (see
 * reference_task_secret_pattern memory): same env var name, same header/query fallback, same fail-closed
 * behavior, same timing-safe comparison, ported to this service's AppError/next() error convention
 * instead of writing the response directly.
 */
export function requireTaskSecret(req: Request, _res: Response, next: NextFunction): void {
  const expectedSecret = stripQuotes(process.env.TASK_SECRET); // read fresh every request, not cached

  if (!expectedSecret) {
    next(new AppError("Server configuration error: TASK_SECRET is not set", 500));
    return;
  }

  const providedSecretRaw = req.headers["x-task-secret"] ?? req.query.task_secret;
  const providedSecret = Array.isArray(providedSecretRaw) ? providedSecretRaw[0] : providedSecretRaw;

  if (typeof providedSecret !== "string" || !safeSecretEquals(providedSecret, expectedSecret)) {
    next(new AppError("Unauthorized: invalid or missing task secret", 401));
    return;
  }

  next();
}
