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
}

export interface MetricsHistoryEntry {
  fiscalYear: number;
  fiscalQuarter: number;
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
  /** Oldest to newest, per analysis-ts's own ordering (confirmed live, same as the other history endpoints). */
  entries: MetricsHistoryEntry[];
}
