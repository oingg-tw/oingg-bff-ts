import { fetchFlatMetricHistory } from "@/domainBff/stock/metricHistoryShared.js";
import type { RoaHistoryResult, RoeHistoryResult, RoeRoaHistoryBasis } from "@/domainBff/stock/roeRoaHistory.types.js";

/**
 * Fetches ROE (股東權益報酬率) quarterly history from analysis-ts's GET /companies/roe-history.
 * Confirmed live (2026-09-07): allows all 3 basis values (Q, Q_ANN, TTM) — unlike metric-history, whose
 * valid basis set differs per metricCode. An unknown or not-yet-backfilled symbol comes back with an
 * empty `entries` array, never a 404.
 *
 * analysis-ts renamed this endpoint's query param from `basis` to `periodType` on 2026-09-08 (same
 * `metric_values.basis` naming split as metric-history — see its client for the full rationale). Allowed
 * values unchanged; kept this client's own parameter/type names as `basis`, only the wire-level param
 * sent upstream changed.
 */
export async function fetchRoeHistory(
  symbol: string,
  basis: RoeRoaHistoryBasis,
  limit?: number,
): Promise<RoeHistoryResult> {
  const searchParams: Record<string, string> = { symbol, periodType: basis };
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }
  const page = await fetchFlatMetricHistory("/companies/roe-history", searchParams, "ROE history");
  return { symbol, basis, ...page };
}

/**
 * Fetches ROA (資產報酬率) quarterly history from analysis-ts's GET /companies/roa-history. Same basis
 * rules and empty-array-not-404 behavior as fetchRoeHistory — see its docstring.
 */
export async function fetchRoaHistory(
  symbol: string,
  basis: RoeRoaHistoryBasis,
  limit?: number,
): Promise<RoaHistoryResult> {
  const searchParams: Record<string, string> = { symbol, periodType: basis };
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }
  const page = await fetchFlatMetricHistory("/companies/roa-history", searchParams, "ROA history");
  return { symbol, basis, ...page };
}
