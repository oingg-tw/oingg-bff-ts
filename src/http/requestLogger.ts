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
      {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        responseTimeMs: Date.now() - startedAt,
        // 限流的分桶鍵取自這條鏈的最右邊（見 routes.ts 的 rateLimitKey），而 Cloud Run 到底是覆寫整個
        // XFF 還是把真實 IP 附加在後面，從外面看不出來——記下整條鏈是唯一能驗證那個鍵取對了的方式。
        // 2026-10-04 的缺陷（限流額度全站共用）就是因為沒有任何地方看得到這個值。
        forwardedFor: req.headers["x-forwarded-for"] ?? null,
      },
      "request completed",
    );
  });
  next();
}
