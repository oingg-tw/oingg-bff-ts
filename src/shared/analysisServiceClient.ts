import { AppError } from "@/shared/errorHandler.js";
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
