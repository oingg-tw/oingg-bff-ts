import type { FlatHistoryEntry, HistoryCoverage } from "@/application/proxy/stock/historyShared.types.js";

/**
 * 期別不列舉，由上游驗證。**這裡曾經是 `"Q" | "Q_ANN" | "TTM"`，而那份白名單在 2026-10-01 一天內被證明
 * 錯了兩次**：Q_ANN 上游在 2026-09-14（054ae0b4）整批移除「單季年化」時刪掉了（我們的值在那之前是對的，
 * 他們沒有逐支通知）；同日他們又給 roe 補上 FY，於是收窄後的 `"Q" | "TTM"` 又太窄。
 *
 * 關鍵是**這個型別同時給 roe 與 roa 用，而兩支的合法集合已經不同**（roe 有 FY、roa 沒有），所以任何
 * 列舉都必然在其中一支上是錯的。驗證留在上游，說明見 route.ts 的 roeRoaHistoryQuerySchema。
 */
export type RoeRoaHistoryBasis = string;

export interface RoeHistoryResult {
  symbol: string;
  basis: RoeRoaHistoryBasis;
  /** Full count available (not just this page) — see historyShared.types.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  /** 上游 roe／roa-history 目前不送 coverage（2026-10-08 實測），所以現在一律是 null；上游加了就會帶出來。 */
  coverage: HistoryCoverage | null;
  entries: FlatHistoryEntry[];
}

export interface RoaHistoryResult {
  symbol: string;
  basis: RoeRoaHistoryBasis;
  /** Full count available (not just this page) — see historyShared.types.ts's HistoryPageMeta. */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  /** 上游 roe／roa-history 目前不送 coverage（2026-10-08 實測），所以現在一律是 null；上游加了就會帶出來。 */
  coverage: HistoryCoverage | null;
  entries: FlatHistoryEntry[];
}
