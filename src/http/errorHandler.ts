import type { NextFunction, Request, Response } from "ultimate-express";
import { env } from "@/shared/env.js";
import { logger } from "@/shared/logger.js";
import { AppError } from "@/domain/appError.js";

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

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err }, "Non-operational AppError");
    }
    res.status(err.statusCode).json({
      error: { message: err.message, code: err.code, details: env.isProduction ? undefined : err.details },
    });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: { message: "Internal server error" } });
}
