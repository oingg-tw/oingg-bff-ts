import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { CbcPolicyRateEntry, CbcPolicyRateResult } from "@/domainBff/macro/macro.types.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function normalizeEntry(raw: unknown): CbcPolicyRateEntry {
  const r = raw as Record<string, unknown>;
  return {
    effectiveDate: String(r.effectiveDate),
    discountRate: Number(r.discountRate),
    collateralAccommodationRate: Number(r.collateralAccommodationRate),
    unsecuredAccommodationRate: Number(r.unsecuredAccommodationRate),
    changeBp: toNumberOrNull(r.changeBp),
  };
}

/**
 * Fetches the CBC policy-rate event series from analysis-ts's GET /macro/cbc-policy-rate — added 2026-09-21
 * for web-nuxt's "TAIEX overlaid with rate-hike/cut events" chart (pair with GET /market/taiex-daily-price's
 * `interval=monthly`, since the rate history reaches 1989 and daily TAIEX only reaches ~2018 within its
 * row limit). `from` ("YYYY-MM-DD") keeps only events with effectiveDate >= that day; omitted returns the
 * whole history. Format is validated locally before this is called (see macro.service.ts) — analysis-ts
 * 400s on a malformed value too, this just avoids the round trip.
 */
export async function fetchCbcPolicyRate(from?: string): Promise<CbcPolicyRateResult> {
  const url = buildAnalysisServiceUrl("/macro/cbc-policy-rate", from !== undefined ? { from } : undefined);
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "CBC policy rate endpoint");

  const body: unknown = await response.json();
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) {
    logger.error({ url: url.toString() }, "CBC policy rate endpoint response is missing an entries array");
    throw new AppError("CBC policy rate endpoint response is missing an entries array", 502);
  }

  return { entries: entries.map(normalizeEntry) };
}
