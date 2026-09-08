import { fetchFlatMetricHistory } from "@/domainBff/stock/metricHistoryShared.js";
import type { MetricHistoryBasis, MetricHistoryCode, MetricHistoryResult } from "@/domainBff/stock/metricHistory.types.js";

/**
 * Fetches a quarterly metric time series from analysis-ts's GET /companies/metric-history — figures
 * they've recomputed themselves from validated eps/bvps formulas (not a relay of raw daily_valuation),
 * with knowledgeDate aligned to the financial-report announcement date, not a daily market-data date.
 *
 * Each metricCode only allows specific basis values (confirmed live, 2026-09-07 — not the same for
 * every code, so don't assume one basis per metric): `eps` allows both `TTM` and `Q`, `peRatio` only
 * `TTM`, `pbRatio` only `Q`. analysis-ts validates this combination itself and returns 400 with a clear
 * message — relayed as-is (see metricHistoryShared.ts's fetchFlatMetricHistory).
 *
 * An unknown or not-yet-backfilled symbol comes back with an empty `entries` array, never a 404 — as of
 * 2026-09-07 only 2330 has any backfilled history at all for any metricCode.
 *
 * analysis-ts renamed this endpoint's query param from `basis` to `token` on 2026-09-08 (part of a wider
 * rename splitting their internal `metric_values.basis` column into periodType/lookbackRange/
 * samplingInterval/snapshotCadence — "basis" was overloading an accounting reserved word). Kept this
 * client's own parameter/type names as `basis` deliberately — bff-ts's own public contract to web-nuxt is
 * unaffected, only the wire-level param sent upstream changed.
 */
export async function fetchMetricHistory(
  symbol: string,
  metricCode: MetricHistoryCode,
  basis: MetricHistoryBasis,
  limit?: number,
): Promise<MetricHistoryResult> {
  const searchParams: Record<string, string> = { symbol, metricCode, token: basis };
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }

  const page = await fetchFlatMetricHistory("/companies/metric-history", searchParams, "Metric history");
  return { symbol, metricCode, basis, ...page };
}
