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
  /**
   * 這一期用的財務報表類型：`"2"` = 合併報表、`"1"` = 個體報表（MOPS 的 dataType 編號，**跟
   * companyProfile 的 `financialReportType` 方向相反**，見那邊的說明）。2026-09-27 新增。
   *
   * **為什麼逐期而不是逐公司**：有 31 家公司賣掉或併掉子公司後只申報個別報表，analysis-ts 把兩段歷史
   * 接成一條線，所以同一條數列裡轉換點之前是合併、之後是個別。公司層級的 `metricDataType` 只說得出
   * 「現在」用哪一種，說不出哪一期是哪一種。一般公司每一期恆為 `"2"`、249 家個別申報者恆為 `"1"`。
   *
   * **選填的理由不是「可能漏送」**：日頻指標（exchangePeRatio、live* 等）走這支端點時沒有報表類型的
   * 概念，所以上游不送這個欄位（實測 2330 的 exchangePeRatio.EOD 沒有 dataType，但有 tradeDate）。
   * 所以 null 的意思是「這個指標不適用報表類型」，不是「不知道」——季頻指標（Q/TTM/FY）缺這個欄位才是
   * 版本錯開。
   *
   * **但在 bff-ts 這一側目前沒有活的 null 實例**（2026-09-27 實測）：單數 metric-history 的 metricCode
   * 是硬編碼的 5 個季頻指標（eps/peRatio/pbRatio/bvps/stockPrice），複數 metrics-history 則被上游擋掉
   * 逐日型指標（回 400），所以日頻指標兩支都到不了這個形狀。維持 nullable 是照上游的契約而不是照實例——
   * 收緊成必填的話，任一支端點哪天放寬到日頻指標就會在這一層被擋掉。這跟 badge 的 `allPositiveFieldIds`
   * 是同一種情況（0 個實例但型別保留），見那邊的說明。
   */
  dataType: "1" | "2" | null;
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
