/**
 * The entry/page shapes shared by analysis-ts's family of quarterly-history endpoints.
 *
 * These used to sit in metricHistoryShared.ts next to the fetch+normalize helper that produces them,
 * but that file also imported analysisServiceClient, which put an outbound HTTP client inside the
 * application layer. Only the helper needed to be down there: the shapes are part of this slice's own
 * outward contract (metricHistory.types.ts and roeRoaHistory.types.ts build their results out of them,
 * and those are what the routes serialize), so the file was split rather than moved wholesale — types
 * stay here, the fetching moved to infrastructure/analysisApi/stock/historyShared.client.ts.
 */

export interface FlatHistoryEntry {
  fiscalYear: number;
  fiscalQuarter: number;
  /** Null when the underlying figure couldn't be computed for this quarter — see nullReason. */
  value: number | null;
  /** Why `value` is null (e.g. a missing trailing quarter of data) — null when `value` is present. */
  nullReason: string | null;
  /**
   * The financial-report announcement date this figure is aligned to — not a daily market-data date, and
   * **not a "last modified" stamp**. It says when the market learned the underlying report, so it does not
   * move when analysis-ts recomputes the figure under a new formula: 2330's 2022Q4 dupont ROE was rewritten
   * 34.91 → 40.14 on 2026-09-23 while its knowledgeDate stayed 2023-02-14 (verified live). Never use it as
   * a cache-invalidation key — a cache holding a pre-recompute value will look current forever.
   */
  knowledgeDate: string;
  /** True when knowledgeDate is a fallback estimate rather than the real announcement date. */
  knowledgeDateIsFallback: boolean;
  /**
   * 這個值是用第幾版公式算出來的（analysis-ts 2026-09-26 新增）。跟 `GET /metrics` 的
   * `formulaVersion`（＝**目前**的算法版本）比對：
   *
   *     兩者相同   這個值是最新算法的結果
   *     格子較舊   算法改了但這一列還沒重算 —— 值仍然自洽、可以正常顯示，**但不應快取**
   *
   * 為什麼需要它：算法改動會讓數值變，而在此之前下游沒有任何辦法知道。型錄的版本號在重算開始時
   * 就跳號、資料列卻是陸續更新的，所以只看型錄會「以新版本號快取舊數值」，而版本號之後不再動，
   * 那份快取就永遠不會失效。要判斷手上這個值新不新，只有逐格的版本號做得到。
   *
   * **宣告成可為 null，而 analysis-ts 的契約說它必填——這跟 dividendHistory 那兩個欄位的處理相反，
   * 差別在「缺了會壞掉什麼」。** 那邊缺欄位會讓金額變成 NaN、序列化成 null，使用者看到的是錯的數字，
   * 所以丟 502 比較好。這裡缺了只是下游少一個過期提示，退回到這個欄位存在之前的狀態，沒有任何
   * 使用者看得到的數字會錯——為此讓所有公司的歷史查詢整支失敗不成比例。缺席時會記一筆 warning，
   * 所以版本錯開仍然看得見，只是不會中斷服務。
   */
  formulaVersion: number | null;
}

/**
 * Pagination metadata analysis-ts added to every history endpoint in this domain (2026-09-07, same day
 * as the endpoints themselves — not present in the very first responses this codebase saw, which is why
 * it was initially missed on 3 of the 5 endpoints until web-nuxt's tenYearDisabled UI logic surfaced the
 * gap). `total` is the full count available (not just what this page returned); `hasMore` is whether a
 * higher `limit` would return more entries than this call did.
 */
export interface HistoryPageMeta {
  total: number;
  hasMore: boolean;
}

export type FlatHistoryPage = HistoryPageMeta & { entries: FlatHistoryEntry[] };
