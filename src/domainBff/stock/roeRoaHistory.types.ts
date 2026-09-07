import type { FlatHistoryEntry } from "@/domainBff/stock/metricHistoryShared.js";

/** Q_ANN = a single quarter's figure annualized (×4), distinct from TTM (trailing twelve months). */
export type RoeRoaHistoryBasis = "Q" | "Q_ANN" | "TTM";

export interface RoeHistoryResult {
  symbol: string;
  basis: RoeRoaHistoryBasis;
  /** Full count available (not just this page) — see metricHistoryShared.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  entries: FlatHistoryEntry[];
}

export interface RoaHistoryResult {
  symbol: string;
  basis: RoeRoaHistoryBasis;
  /** Full count available (not just this page) — see metricHistoryShared.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  entries: FlatHistoryEntry[];
}
