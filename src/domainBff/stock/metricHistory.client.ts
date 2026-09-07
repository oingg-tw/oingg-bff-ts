import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  MetricHistoryBasis,
  MetricHistoryCode,
  MetricHistoryEntry,
  MetricHistoryResult,
} from "@/domainBff/stock/metricHistory.types.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeEntry(raw: unknown): MetricHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    fiscalYear: Number(r.fiscalYear),
    fiscalQuarter: Number(r.fiscalQuarter),
    value: toNumberOrNull(r.value),
    nullReason: toStringOrNull(r.nullReason),
    knowledgeDate: String(r.knowledgeDate),
    knowledgeDateIsFallback: r.knowledgeDateIsFallback === true,
  };
}

function isMetricHistoryResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches a quarterly metric time series from analysis-ts's GET /companies/metric-history — figures
 * they've recomputed themselves from validated eps/bvps formulas (not a relay of raw daily_valuation),
 * with knowledgeDate aligned to the financial-report announcement date, not a daily market-data date.
 *
 * Each metricCode only allows specific basis values (confirmed live, 2026-09-07 — not the same for
 * every code, so don't assume one basis per metric): `eps` allows both `TTM` and `Q`, `peRatio` only
 * `TTM`, `pbRatio` only `Q`. analysis-ts validates this combination itself and returns 400 with a clear
 * message — relayed here as-is rather than masked as a generic 502, same pattern as
 * etfScreener.client.ts's handleJsonResponse.
 *
 * An unknown or not-yet-backfilled symbol comes back with an empty `entries` array, never a 404 — as of
 * 2026-09-07 only 2330 has any backfilled history at all for any metricCode.
 */
export async function fetchMetricHistory(
  symbol: string,
  metricCode: MetricHistoryCode,
  basis: MetricHistoryBasis,
  limit?: number,
): Promise<MetricHistoryResult> {
  const searchParams: Record<string, string> = { symbol, metricCode, basis };
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }

  const url = buildAnalysisServiceUrl("/companies/metric-history", searchParams);
  const response = await fetchAnalysisService(url);

  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== "string") {
      logger.error({ url: url.toString() }, "Invalid metric history request, no message in response body");
    }
    throw new AppError(typeof message === "string" ? message : "Invalid metric history request", 400);
  }
  assertAnalysisServiceOk(response, url, "Metric history endpoint");

  const body: unknown = await response.json();
  if (!isMetricHistoryResponse(body)) {
    logger.error({ url: url.toString() }, "Metric history endpoint response is missing an entries array");
    throw new AppError("Metric history endpoint response is missing an entries array", 502);
  }

  return {
    symbol,
    metricCode,
    basis,
    entries: body.entries.map(normalizeEntry),
  };
}
