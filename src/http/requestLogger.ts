import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "ultimate-express";
import { logger } from "@/shared/logger.js";

/**
 * 這個請求的 ID（2026-10-08）：回應的 X-Request-Id header、錯誤回應的 RFC 9457 `instance`、以及這裡的 log
 * 都是同一個值，使用者回報時引用它就能在 log 找到那一行。永遠自己產生、不沿用客戶端送來的值——`instance`
 * 要寫成 urn:uuid:，外來的字串不保證是 UUID。
 */
export function requestIdOf(res: Response): string {
  const locals = res.locals as { requestId?: string };
  locals.requestId ??= randomUUID();
  return locals.requestId;
}

/**
 * One structured log line per completed request. Written by hand instead of using pino-http: verified
 * live that pino-http's autoLogging misreports every successful request as "request aborted" on this
 * stack — ultimate-express runs on uWebSockets.js, not Node's http.Server, and doesn't emit the
 * finish/close event sequence pino-http's completion-detection expects. `res.on("finish", ...)` alone is
 * the one signal that's actually reliable here: it only fires once the full response has been sent.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  const requestId = requestIdOf(res);
  res.on("finish", () => {
    logger.info(
      {
        requestId,
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
