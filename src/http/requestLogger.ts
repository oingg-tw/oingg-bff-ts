import type { NextFunction, Request, Response } from "ultimate-express";
import { logger } from "@/shared/logger.js";

/**
 * One structured log line per completed request. Written by hand instead of using pino-http: verified
 * live that pino-http's autoLogging misreports every successful request as "request aborted" on this
 * stack — ultimate-express runs on uWebSockets.js, not Node's http.Server, and doesn't emit the
 * finish/close event sequence pino-http's completion-detection expects. `res.on("finish", ...)` alone is
 * the one signal that's actually reliable here: it only fires once the full response has been sent.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  res.on("finish", () => {
    logger.info(
      { method: req.method, url: req.originalUrl, statusCode: res.statusCode, responseTimeMs: Date.now() - startedAt },
      "request completed",
    );
  });
  next();
}
