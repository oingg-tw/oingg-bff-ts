import type { NextFunction, Request, Response } from "ultimate-express";
import { env } from "@/shared/env.js";
import { logger } from "@/shared/logger.js";

export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;
  readonly details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err }, "Non-operational AppError");
    }
    res.status(err.statusCode).json({
      error: { message: err.message, details: env.isProduction ? undefined : err.details },
    });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: { message: "Internal server error" } });
}
