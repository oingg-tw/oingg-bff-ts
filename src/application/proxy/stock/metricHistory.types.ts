import type { FlatHistoryEntry, HistoryCoverage } from "@/application/proxy/stock/historyShared.types.js";

export type MetricHistoryCode = "eps" | "peRatio" | "pbRatio" | "bvps" | "stockPrice";
export type MetricHistoryBasis = "TTM" | "Q";

export type MetricHistoryEntry = FlatHistoryEntry;

export interface MetricHistoryResult {
  symbol: string;
  metricCode: MetricHistoryCode;
  basis: MetricHistoryBasis;
  /** Full count available (not just this page) — see historyShared.types.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  coverage: HistoryCoverage | null;
  /** Oldest to newest, per analysis-ts's own ordering. */
  entries: MetricHistoryEntry[];
}
