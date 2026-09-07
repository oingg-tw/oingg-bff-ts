import type { FlatHistoryEntry } from "@/domainBff/stock/metricHistoryShared.js";

export type MetricHistoryCode = "eps" | "peRatio" | "pbRatio";
export type MetricHistoryBasis = "TTM" | "Q";

export type MetricHistoryEntry = FlatHistoryEntry;

export interface MetricHistoryResult {
  symbol: string;
  metricCode: MetricHistoryCode;
  basis: MetricHistoryBasis;
  /** Oldest to newest, per analysis-ts's own ordering. */
  entries: MetricHistoryEntry[];
}
