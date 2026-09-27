import { AppError } from "@/domain/appError.js";
import { ANALYSIS_SERVICE_TIMEOUT_MS, requireEnv } from "@/shared/env.js";
import { logger } from "@/shared/logger.js";

/** Builds a URL against analysis-ts's FILTERS_SERVICE_URL host, optionally setting query params. */
export function buildAnalysisServiceUrl(path: string, searchParams?: Record<string, string>): URL {
  const url = new URL(path, requireEnv("FILTERS_SERVICE_URL"));
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

/**
 * fetch() itself throws (not a rejected-but-caught HTTP response) for connection-level failures —
 * refused/unreachable host, DNS, timeout — converted here to a clear 502 instead of an uncaught 500.
 * The internal URL is logged server-side only; the client-facing message never includes it (would leak
 * bff-ts's internal service topology to the end user — see errorHandler.ts, which only gates `details`
 * by NODE_ENV, never `message`).
 *
 * analysis-ts requires an `X-Api-Key` header on every domainApi request as of 2026-09-04 (health check
 * and /batch/compute are the only exceptions, neither of which bff-ts calls) — attached here, the single
 * place every outbound request already flows through, so every call site gets it automatically.
 */
export async function fetchAnalysisService(url: URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Api-Key", requireEnv("BFF_API_KEY"));
  try {
    return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(ANALYSIS_SERVICE_TIMEOUT_MS) });
  } catch (error) {
    logger.error({ err: error, url: url.toString() }, "Could not reach the analysis service");
    throw new AppError("Could not reach the analysis service", 502);
  }
}

/**
 * Throws a generic 502 (never including the internal URL) for a non-ok response. Callers needing
 * custom handling for a specific status first (404 → null, 400 → relay analysis-ts's own message)
 * should branch on `response.status` before calling this.
 */
export function assertAnalysisServiceOk(response: Response, url: URL, label: string): void {
  if (!response.ok) {
    logger.error({ url: url.toString(), status: response.status }, `${label} returned a non-2xx status`);
    throw new AppError(`${label} returned ${response.status}`, 502);
  }
}

/**
 * 讀一個「上游保證一定是數字」的欄位，缺了就在邊界上丟 502 而不是靜默給 null 或 0。
 *
 * 2026-09-25 從 dividendHistory.client.ts 的私有函式抽上來（book-value-breakdown 是第二個呼叫端）。
 * 當初的脈絡：上游改名而 bff-ts 還讀舊名時，`Number(undefined)` 產生 NaN、序列化成 null，而型別說那個
 * 欄位不可為 null——版本錯開被型別吸收掉，只能靠手動打上游比對才發現。丟 502 讓一個請求就講出是哪個
 * 欄位不見了。代價是改版空窗期那支端點會整支失敗，那是正確的：資料確實無法以宣告的形狀提供。
 *
 * **不要用在「上游可能為 null」的欄位上**——那種欄位的型別本來就該是 `number | null`，用
 * `typeof value === "number" && Number.isFinite(value) ? value : null` 判斷（別用 `Number()`，
 * `Number(null)` 是 0 不是 NaN，見 dailyPriceHistory.client.ts 的說明）。
 */
export function requireNumber(value: unknown, field: string, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    logger.error({ field, received: typeof value }, `${label} is missing a field upstream guarantees — likely a field rename that bff-ts has not followed`);
    throw new AppError(`${label} response is missing the numeric field ${field}`, 502);
  }
  return value;
}

