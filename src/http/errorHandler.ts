import { STATUS_CODES } from "node:http";
import type { NextFunction, Request, Response } from "ultimate-express";
import { env } from "@/shared/env.js";
import { logger } from "@/shared/logger.js";
import { AppError } from "@/domain/appError.js";
import { requestIdOf } from "@/http/requestLogger.js";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
}

/**
 * Turns a malformed JSON request body into a 400 instead of letting it reach errorHandler's catch-all 500
 * (found 2026-09-22: POST /screener with a broken body answered "Internal server error"). ultimate-express's
 * JSON parser throws a bare SyntaxError with none of Express's `status`/`type: "entity.parse.failed"`
 * markers, so there's nothing to match on but the type — which is exactly why this must be mounted
 * immediately after express.json() rather than folded into errorHandler: at that point a SyntaxError can
 * only have come from parsing the request body. A SyntaxError raised later, by `response.json()` on a
 * malformed analysis-ts reply, is an upstream fault (502 via assertAnalysisServiceOk / AppError) and must
 * never be reported to the caller as their bad request.
 */
export function jsonBodyErrorHandler(err: unknown, _req: Request, _res: Response, next: NextFunction): void {
  if (err instanceof SyntaxError) {
    next(new AppError("Request body is not valid JSON", 400));
    return;
  }
  next(err);
}

/**
 * Every error response is an RFC 9457 problem object (2026-10-08; the user's call: 「人家訂了標準就用吧」).
 *
 * - `type`: "about:blank" (RFC 9457 §4.2.1: "no additional semantics beyond that of the HTTP status code")
 *   unless the error carries a `code` — a code exists precisely because the problem means more than its
 *   status (quota_exceeded is not just any 403), so it gets its own type, a tag URI derived from the code
 *   (`tag:oingg.com,2026:quota-exceeded`). §3.1.1 allows non-resolvable type URIs and names the tag scheme
 *   as the example. Swap in resolvable documentation URLs if those ever exist — that's a contract change.
 *   `title` stays the HTTP reason phrase, which is static per type because each code has one status.
 * - `instance` is urn:uuid:<the request ID>, the same value as the X-Request-Id header and the log line.
 * - `code` and AppError.extensions are extension members, sent in every environment. `details` is a
 *   debugging aid and only appears outside production.
 * - The pre-9457 `error: { message, code }` envelope was sent alongside for one day and removed once
 *   web-nuxt read the top-level members (their e51cc66, 2026-10-08).
 *
 * Sent as application/problem+json; ofetch's JSON detection (/^application\/(?:[\w!#$%&*.^`~-]*\+)?json/)
 * parses it the same as application/json.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const requestId = requestIdOf(res);
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err, requestId }, "Non-operational AppError");
    }
    sendProblem(res, requestId, err.statusCode, err.message, err.code, err.extensions, env.isProduction ? undefined : err.details);
    return;
  }

  logger.error({ err, requestId }, "Unhandled error");
  sendProblem(res, requestId, 500, "Internal server error");
}

function sendProblem(
  res: Response,
  requestId: string,
  status: number,
  detail: string,
  code?: string,
  extensions?: Record<string, unknown>,
  details?: unknown,
): void {
  const problem = {
    ...extensions,
    type: code === undefined ? "about:blank" : `tag:oingg.com,2026:${code.toLowerCase().replaceAll("_", "-")}`,
    title: STATUS_CODES[status] ?? "Error",
    status,
    detail,
    instance: `urn:uuid:${requestId}`,
    ...(code === undefined ? {} : { code }),
    ...(details === undefined ? {} : { details }),
  };
  res.set("X-Request-Id", requestId);
  res.status(status).type("application/problem+json").send(JSON.stringify(problem));
}
