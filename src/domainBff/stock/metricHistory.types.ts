import type { FlatHistoryEntry } from "@/domainBff/stock/metricHistoryShared.js";

export type MetricHistoryCode = "eps" | "peRatio" | "pbRatio" | "bvps";
export type MetricHistoryBasis = "TTM" | "Q";

export type MetricHistoryEntry = FlatHistoryEntry;

export interface MetricHistoryResult {
  symbol: string;
  metricCode: MetricHistoryCode;
  basis: MetricHistoryBasis;
  /** Full count available (not just this page) — see metricHistoryShared.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  /** Oldest to newest, per analysis-ts's own ordering. */
  entries: MetricHistoryEntry[];
}
