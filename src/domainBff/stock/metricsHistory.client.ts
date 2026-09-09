import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { MetricsHistoryEntry, MetricsHistoryResult, MetricsHistoryValue } from "@/domainBff/stock/metricsHistory.types.js";

/**
 * A metricCode's value in a period can be the literal `null` (not an object at all) when that metric has
 * no backfilled data whatsoever for the period — confirmed live, 2026-09-10 (caused a 500 here before this
 * fix: `raw as Record<string, unknown>` on a `null` value still type-checks, but `r.value` at runtime
 * throws `TypeError: Cannot read properties of null`, since `raw` was never an object to begin with).
 * Genuinely different from an object with `value: null` (computed, with a real nullReason/knowledgeDate) —
 * preserved as `null` here rather than coerced into a fake object, so callers can tell the two apart.
 */
function normalizeValue(raw: unknown): MetricsHistoryValue | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  return {
    value: typeof r.value === "number" ? r.value : null,
    nullReason: typeof r.nullReason === "string" ? r.nullReason : null,
    knowledgeDate: String(r.knowledgeDate),
    knowledgeDateIsFallback: r.knowledgeDateIsFallback === true,
  };
}

function normalizeEntry(raw: unknown): MetricsHistoryEntry {
  const r = raw as Record<string, unknown>;
  const rawValues = (r.values ?? {}) as Record<string, unknown>;
  const values: Record<string, MetricsHistoryValue | null> = {};
  for (const [metricCode, value] of Object.entries(rawValues)) {
    values[metricCode] = normalizeValue(value);
  }
  return { fiscalYear: Number(r.fiscalYear), fiscalQuarter: Number(r.fiscalQuarter), values };
}

function isMetricsHistoryResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches multiple metrics' history for one symbol in a single call from analysis-ts's own
 * GET /companies/metrics-history?symbol=&metricCodes=a,b,c&token= — added 2026-09-09 for stock-detail
 * "growth decomposition" cards (e.g. netIncomeGrowthRate/epsGrowthRate/shareCountChangeRate) that need
 * several related metrics for the same fiscal period at once, without one round trip per metric.
 *
 * Response shape genuinely differs from the single-metric metric-history endpoint: one entry per fiscal
 * period with a `values` map keyed by metricCode, not a flat `value` field — doesn't share
 * metricHistoryShared.ts's helper (same reason dupont-history doesn't). `token` is a single value shared
 * by every requested metricCode; analysis-ts validates each metricCode actually supports it and returns a
 * 400 with a clear message otherwise (confirmed live: netIncomeGrowthRate only supports "Q", not "TTM") —
 * relayed as-is, same convention as the other history endpoints in this domain. limit bounds are 1-40,
 * default 20 — same as the single-metric endpoint. An unknown symbol returns `entries: []`, not a 404.
 */
export async function fetchMetricsHistory(symbol: string, metricCodes: string[], token: string, limit?: number): Promise<MetricsHistoryResult> {
  const searchParams: Record<string, string> = { symbol, metricCodes: metricCodes.join(","), token };
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }

  const url = buildAnalysisServiceUrl("/companies/metrics-history", searchParams);
  const response = await fetchAnalysisService(url);

  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== "string") {
      logger.error({ url: url.toString() }, "Invalid metrics history request, no message in response body");
    }
    throw new AppError(typeof message === "string" ? message : "Invalid metrics history request", 400);
  }
  assertAnalysisServiceOk(response, url, "Metrics history endpoint");

  const body: unknown = await response.json();
  if (!isMetricsHistoryResponse(body)) {
    logger.error({ url: url.toString() }, "Metrics history endpoint response is missing an entries array");
    throw new AppError("Metrics history endpoint response is missing an entries array", 502);
  }

  const b = body as { total?: unknown; hasMore?: unknown };
  return {
    symbol,
    metricCodes,
    token,
    total: typeof b.total === "number" ? b.total : 0,
    hasMore: b.hasMore === true,
    entries: body.entries.map(normalizeEntry),
  };
}
