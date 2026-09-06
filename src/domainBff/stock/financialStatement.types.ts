export type FinancialStatementType = "balanceSheet" | "incomeStatement" | "cashFlowStatement";

/**
 * One quarter's complete raw statement line items (not ratios) — for a frontend "會計模式" (accounting
 * mode), distinct from the ratio/metric-based filterCatalog data the screener uses. Confirmed with
 * analysis-ts directly (2026-09-06) via real 2330 115Q2 examples for all three statementTypes.
 */
export interface FinancialStatementResult {
  symbol: string;
  statementType: FinancialStatementType;
  /** Passed through as-is — analysis-ts's own internal report-type code, meaning not confirmed with them. */
  dataType: string | null;
  /** Passed through as-is — empty string for a top-level (non-subsidiary) company in every example seen. */
  subsidiaryCompanyId: string | null;
  /** ROC year (e.g. "115"), null when found is false. */
  year: string | null;
  /** 1-4, null when found is false. */
  season: string | null;
  /** "YYYY-MM-DD", null when found is false. */
  reportDate: string | null;
  /** false for an unknown symbol or a year/season with no filed statement — still a 200, not a 404. */
  found: boolean;
  /**
   * Line items keyed by camelCase field name (e.g. "cashAndEquivalents") — the actual key set differs
   * per statementType and isn't enumerated here (analysis-ts may add fields over time). Every value is a
   * bigint-serialized string to avoid precision loss, except "eps"/"epsDiluted" on incomeStatement which
   * are strings natively (decimal source data, not bigint-serialized) — analysis-ts confirmed both are
   * still plain strings either way, so no special-casing is needed here. A null value means the source
   * statement genuinely has no figure for that line item (not queried/undisclosed), not a fetch failure.
   * null (not an object) when found is false.
   */
  statement: Record<string, string | null> | null;
}
