import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "ultimate-express";
import { requireEnv } from "@/shared/env.js";

const BASIC_PREFIX = "Basic ";

/** `docker run --env-file` doesn't strip quotes the way dotenv does — same fix as oingg-twse-ts's TASK_SECRET. */
function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** Constant-time string comparison — a length check up front would leak length via timing, so pad instead of short-circuiting. */
function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Gates /api-docs (Swagger UI + the real generated OpenAPI spec) behind HTTP Basic Auth — OWASP API9
 * finding (see docs/BFF 架構資安 Checklist.md): the full API surface was reachable by anyone who could
 * reach this port, no auth at all. Basic Auth rather than Firebase requireAuth: the audience here is
 * developers/team members browsing docs, not end users of the product, and a browser natively prompts
 * for username/password on a 401 + WWW-Authenticate.
 *
 * Fails closed (500, via requireEnv throwing) if API_DOCS_USER/API_DOCS_PASSWORD aren't configured at
 * all, in every environment — same reasoning as TASK_SECRET elsewhere in the ecosystem: exercise this
 * code path in dev too (with a throwaway value) instead of leaving it silently untested until a real
 * deploy exposes the gap.
 */
export function requireApiDocsAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedUser = stripQuotes(requireEnv("API_DOCS_USER"));
  const expectedPassword = stripQuotes(requireEnv("API_DOCS_PASSWORD"));

  const header = req.headers.authorization;
  if (header?.startsWith(BASIC_PREFIX)) {
    const decoded = Buffer.from(header.slice(BASIC_PREFIX.length), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex !== -1) {
      const user = decoded.slice(0, separatorIndex);
      const password = decoded.slice(separatorIndex + 1);
      if (timingSafeEqualString(user, expectedUser) && timingSafeEqualString(password, expectedPassword)) {
        next();
        return;
      }
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="oingg-bff-ts API docs"');
  res.status(401).json({ error: { message: "Unauthorized" } });
}
