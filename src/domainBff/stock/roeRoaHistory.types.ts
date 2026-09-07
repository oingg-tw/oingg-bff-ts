import type { FlatHistoryEntry } from "@/domainBff/stock/metricHistoryShared.js";

/** Q_ANN = a single quarter's figure annualized (×4), distinct from TTM (trailing twelve months). */
export type RoeRoaHistoryBasis = "Q" | "Q_ANN" | "TTM";

export interface RoeHistoryResult {
  symbol: string;
  basis: RoeRoaHistoryBasis;
  entries: FlatHistoryEntry[];
}

export interface RoaHistoryResult {
  symbol: string;
  basis: RoeRoaHistoryBasis;
  entries: FlatHistoryEntry[];
}
