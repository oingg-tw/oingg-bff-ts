export type MetricProvenanceMetricCode = "sue" | "chowderNumber" | "roe" | "accrualsRatio" | "dividendPayoutRatio" | "altmanZScore";

export interface MetricProvenanceEntry {
  /** Chinese label describing what this entry is for the computation (e.g. "TTM 淨利（第 1/4 季）"). */
  role: string;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  type: "statementField" | "other";
  /** Only set when type is "statementField". */
  statementType: "balanceSheet" | "incomeStatement" | "cashFlowStatement" | null;
  /** Only set when type is "statementField" — the raw statement line-item key this figure came from. */
  fieldKey: string | null;
  /** Only set when type is "other" — free-text description of the non-statement source (e.g. a TWSE/TPEx daily valuation snapshot or a capital-change filing). */
  sourceDescription: string | null;
  /**
   * Passed through with no type coercion. Most entries are bigint-serialized strings (raw statement
   * figures, e.g. "706561938"), but at least one confirmed-live case (chowderNumber's cash dividend
   * yield "market snapshot" entry) is a plain float (0.92) instead of a string — consumers must not
   * assume either type.
   */
  value: string | number | null;
}

/**
 * The raw-filing provenance trail behind one metric's computed value — backs web-nuxt's "trace this
 * badge's number back to the raw filing" feature. Pilot scope is exactly 3 metricCodes (sue/
 * chowderNumber/roe), zod-validated on both this side and analysis-ts's. Confirmed with analysis-ts
 * directly (2026-09-10) via real 2330 examples for all 3.
 */
export interface MetricProvenanceResult {
  symbol: string;
  metricCode: MetricProvenanceMetricCode;
  /** false for an unknown symbol or a year/season with no data — still a 200, not a 404. */
  found: boolean;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  /** The metric's own computed value for this period (e.g. roe's 34.78) — always a number, unlike entries[].value. */
  value: number | null;
  /** Empty array (not null) when found is false. */
  entries: MetricProvenanceEntry[];
  methodologyNote: string | null;
}
