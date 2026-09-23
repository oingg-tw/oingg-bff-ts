/**
 * The one error type every layer is allowed to throw.
 *
 * It lives in `domain` rather than next to the Express error middleware because it is shared
 * vocabulary, not a delivery detail: a repository saying "this preset isn't yours" and a client saying
 * "analysis-ts returned garbage" both need to express *what went wrong* without importing the web
 * framework. Splitting the type from the middleware is what let `src/infrastructure` stop depending on
 * `src/http` (2026-09-23 — that single import accounted for ~30 layering violations).
 *
 * `statusCode` is admittedly an HTTP concept sitting in the innermost layer. That is a deliberate,
 * bounded compromise for this service specifically: bff-ts is an HTTP gateway whose only delivery
 * mechanism is HTTP, so a status is the honest way to say "how bad is this and whose fault is it",
 * and the alternative — a parallel enum plus a mapping table at the edge — would buy portability this
 * service will never spend. The rule that keeps it from spreading: nothing here may import anything.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;
  readonly details?: unknown;
  /**
   * A stable machine-readable reason, surfaced as `error.code`. Optional and rare on purpose: a status
   * code plus a message is enough for almost everything, and a code is only worth adding when the
   * caller must *branch* on it — e.g. telling "you've hit your plan's limit" apart from any other 403
   * so the UI can show a specific prompt. Unlike `details`, it is sent in production too, since the
   * frontend depends on it.
   */
  readonly code?: string;

  constructor(message: string, statusCode = 500, details?: unknown, code?: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}
