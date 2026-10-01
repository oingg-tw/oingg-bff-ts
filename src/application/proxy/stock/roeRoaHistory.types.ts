import type { FlatHistoryEntry } from "@/application/proxy/stock/historyShared.types.js";

/**
 * 2026-10-01 移除 Q_ANN（原註解寫「單季年化 ×4」）：**上游不收那個值**，實測 periodType=Q_ANN 回 400
 * 「expected one of "Q"|"TTM"」。留著只是對外宣告一個不存在的期別。
 *
 * roe 的 FY 期別不在這裡——那是複數 metrics-history 的，見 route.ts 的 roeRoaHistoryQuerySchema。
 */
export type RoeRoaHistoryBasis = "Q" | "TTM";

export interface RoeHistoryResult {
  symbol: string;
  basis: RoeRoaHistoryBasis;
  /** Full count available (not just this page) — see historyShared.types.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  entries: FlatHistoryEntry[];
}

export interface RoaHistoryResult {
  symbol: string;
  basis: RoeRoaHistoryBasis;
  /** Full count available (not just this page) — see historyShared.types.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  entries: FlatHistoryEntry[];
}
