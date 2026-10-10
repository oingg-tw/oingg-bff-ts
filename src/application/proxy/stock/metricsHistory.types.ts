import type { HistoryCoverage } from "@/application/proxy/stock/historyShared.types.js";
export interface MetricsHistoryValue {
  value: number | null;
  nullReason: string | null;
  knowledgeDate: string;
  knowledgeDateIsFallback: boolean;
  /**
   * 這個值用第幾版公式算的，語意與可為 null 的理由跟 FlatHistoryEntry.formulaVersion 完全相同
   * （跟 GET /metrics 的版本號比對，格子較舊＝還沒重算＝可顯示但不可快取）。
   *
   * 注意這一層有兩種「沒有版本號」，意思不同：
   *   values[code] 整格是 null   該 metricCode 在這一期從未回填過，連格子都不存在 → 沒有版本號可談
   *   格子存在但 formulaVersion 是 null   上游沒送這個欄位，通常是版本錯開
   */
  formulaVersion: number | null;
  /**
   * 每股換算（analysis-ts 2026-10-08 起，docs/api-conventions.md「每股數字的換算基準」）：每股類指標（eps、bvps…）
   * 的歷史值已換算到**今天的股數基準**（分割、配股、股數合併式減資追溯）。`restated` 是這一期有沒有真的被換算、
   * `shareBasisDate` 是換算基準日（查詢當天，台北日期）。**非每股類指標兩者都是 null**（上游不送），不是 false——
   * false 的意思是「每股類，但這一期不需要換算」。股價、比值不換算，兩者相除會差一個倍數，畫河流圖請用
   * valuation-river。
   */
  restated: boolean | null;
  shareBasisDate: string | null;
}

export interface MetricsHistoryEntry {
  fiscalYear: number;
  /** null on annual (FY) rows — they have no quarter. */
  fiscalQuarter: number | null;
  /**
   * 這一期用的財務報表類型：`"2"` = 合併報表、`"1"` = 個別報表（MOPS 的 dataType 編號，**跟
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
   */
  dataType: "1" | "2" | null;

  /**
   * Keyed by the requested metricCode — one entry per fiscal period, all requested metrics together.
   * A metricCode's entry here is the literal JSON `null` (not an object) when that metric has no
   * backfilled data at all for this period — confirmed live, 2026-09-10, e.g. a metricCode backfilled
   * starting from a later fiscal quarter than a sibling metricCode requested in the same call. This is
   * distinct from an object with `value: null` (computed but genuinely null, with a `nullReason` and a
   * real `knowledgeDate`) — don't conflate the two.
   */
  values: Record<string, MetricsHistoryValue | null>;
}

export interface MetricsHistoryResult {
  symbol: string;
  metricCodes: string[];
  /**
   * A single token shared by every metricCode in this request — analysis-ts validates each metricCode
   * supports it (e.g. growth-decomposition codes like netIncomeGrowthRate only support "Q", not "TTM").
   * Not narrowed to a fixed union here (unlike MetricHistoryBasis) since different metricCode combinations
   * need different valid tokens — see GET /metrics' validTokens per metricCode.
   */
  token: string;
  /** Full count available (not just this page). */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  /** 每個 metricCode 各自的資料涵蓋區間（意義見 historyShared.types.ts 的 HistoryCoverage）；上游沒送的 code 不會出現在這裡。 */
  coverage: Record<string, HistoryCoverage>;
  /** Oldest to newest, per analysis-ts's own ordering (confirmed live, same as the other history endpoints). */
  entries: MetricsHistoryEntry[];
}
