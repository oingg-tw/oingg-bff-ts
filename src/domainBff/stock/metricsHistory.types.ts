export interface MetricsHistoryValue {
  value: number | null;
  nullReason: string | null;
  knowledgeDate: string;
  knowledgeDateIsFallback: boolean;
}

export interface MetricsHistoryEntry {
  fiscalYear: number;
  fiscalQuarter: number;
  /** Keyed by the requested metricCode — one entry per fiscal period, all requested metrics together. */
  values: Record<string, MetricsHistoryValue>;
}

export interface MetricsHistoryResult {
  symbol: string;
  metricCodes: string[];
  /**
   * A single token shared by every metricCode in this request — analysis-ts validates each metricCode
   * supports it (e.g. growth-decomposition codes like netIncomeGrowthRate only support "Q", not "TTM").
   * Not narrowed to a fixed union here (unlike MetricHistoryBasis) since different metricCode combinations
   * need different valid tokens — see GET /filters' validTokens per metricCode.
   */
  token: string;
  /** Full count available (not just this page). */
  total: number;
  /** Whether a higher `limit` would return more entries than this call did. */
  hasMore: boolean;
  /** Oldest to newest, per analysis-ts's own ordering (confirmed live, same as the other history endpoints). */
  entries: MetricsHistoryEntry[];
}
