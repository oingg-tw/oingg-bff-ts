export type ExDividendType = "息" | "權" | "權息";

/**
 * "權" covers two distinct mechanisms whose fields never appear together on the same entry (confirmed
 * with analysis-ts): stock-dividend/退休金轉增資 uses `stockDividendRatio`; cash-increase subscription
 * uses `subscriptionRatio`/`subscriptionPricePerShare`/`sharesOffered`/`sharesEmpOwner`/
 * `sharesholderOwner`/`stockHoldingRatio`. A pure "息" entry has only `cashDividend` set, everything else
 * null. All 8 value fields are `number | null` (analysis-ts fixed a bug where these briefly serialized as
 * strings — see feedback_scale_appropriate_governance memory).
 */
export interface ExDividendNoticeEntry {
  /** "YYYY-MM-DD" */
  exDate: string;
  exType: ExDividendType;
  stockDividendRatio: number | null;
  subscriptionRatio: number | null;
  subscriptionPricePerShare: number | null;
  cashDividend: number | null;
  /** Cash-increase subscription fields below — analysis-ts's semantics, not independently verified against twse-ts. */
  sharesOffered: number | null;
  sharesEmpOwner: number | null;
  sharesholderOwner: number | null;
  stockHoldingRatio: number | null;
}
