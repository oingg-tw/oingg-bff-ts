/**
 * Not a fixed enum — analysis-ts's supported metricCode set for this endpoint has grown from an initial
 * pilot of 3 (sue/chowderNumber/roe) to 112+ and keeps expanding (same growing-allowlist pattern as GET
 * /metrics' hasProvenance field, which flags which metricCodes support this endpoint — see
 * metricCatalog.types.ts). bff-ts used to hardcode the allowed set here and reject anything else with its
 * own 400 before ever calling analysis-ts, which meant every expansion on their side required a matching
 * code change here before it actually worked — caught 2026-09-15 when hasProvenance already listed 112
 * metricCodes but this endpoint only accepted 6. Validation is now analysis-ts's own — an unsupported
 * value gets analysis-ts's own 400 message relayed as-is (see metricProvenance.client.ts).
 */
export type MetricProvenanceMetricCode = string;

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
 * badge's number back to the raw filing" feature. Validated by analysis-ts itself, not by a fixed enum on
 * this side (see MetricProvenanceMetricCode) — check GET /metrics' hasProvenance field for which
 * metricCodes currently support this. Confirmed with analysis-ts directly (2026-09-10) via real 2330
 * examples for the initial pilot set.
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
