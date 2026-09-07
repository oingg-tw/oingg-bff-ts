export type MetricHistoryCode = "eps" | "peRatio" | "pbRatio";
export type MetricHistoryBasis = "TTM" | "Q";

export interface MetricHistoryEntry {
  fiscalYear: number;
  fiscalQuarter: number;
  /** Null when the underlying figure couldn't be computed for this quarter — see nullReason. */
  value: number | null;
  /** Why `value` is null (e.g. a missing trailing quarter of data) — null when `value` is present. */
  nullReason: string | null;
  /** The financial-report announcement date this figure is aligned to — not a daily market-data date. */
  knowledgeDate: string;
  /** True when knowledgeDate is a fallback estimate rather than the real announcement date. */
  knowledgeDateIsFallback: boolean;
}

export interface MetricHistoryResult {
  symbol: string;
  metricCode: MetricHistoryCode;
  basis: MetricHistoryBasis;
  /** Oldest to newest, per analysis-ts's own ordering. */
  entries: MetricHistoryEntry[];
}
