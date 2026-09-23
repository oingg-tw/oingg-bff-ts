import type { NextFunction, Request, Response } from "ultimate-express";
import { env, requireEnv } from "@/shared/env.js";
import { stripQuotes, timingSafeEqualString } from "@/shared/secretAuth.js";

const BASIC_PREFIX = "Basic ";

/**
 * Gates /api-docs (Swagger UI + the real generated OpenAPI spec) behind HTTP Basic Auth — OWASP API9
 * finding (see docs/BFF 架構資安 Checklist.md): the full API surface was reachable by anyone who could
 * reach this port, no auth at all. Basic Auth rather than Firebase requireAuth: the audience here is
 * developers/team members browsing docs, not end users of the product, and a browser natively prompts
 * for username/password on a 401 + WWW-Authenticate.
 *
 * Skipped entirely outside production (2026-09-06, reversing the original "fail closed everywhere"
 * design): web-nuxt's sandboxed dev environment can't complete a Basic Auth challenge, and this is only
 * a reconnaissance-surface concern in the first place (every actual sensitive endpoint has its own
 * Firebase requireAuth regardless — see the security discussion this reverses), not worth blocking dev
 * workflows over. Still fails closed (500, via requireEnv throwing) in production if
 * API_DOCS_USER/API_DOCS_PASSWORD aren't configured.
 */
export function requireApiDocsAuth(req: Request, res: Response, next: NextFunction): void {
  if (!env.isProduction) {
    next();
    return;
  }

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
