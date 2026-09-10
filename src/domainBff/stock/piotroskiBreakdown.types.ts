export interface PiotroskiBreakdownProfitabilityGroup {
  positiveRoa: boolean | null;
  positiveCfo: boolean | null;
  roaImproved: boolean | null;
  accrualQuality: boolean | null;
}

export interface PiotroskiBreakdownLeverageLiquidityGroup {
  leverageDecreased: boolean | null;
  liquidityImproved: boolean | null;
  noDilution: boolean | null;
}

export interface PiotroskiBreakdownOperatingEfficiencyGroup {
  grossMarginImproved: boolean | null;
  assetTurnoverImproved: boolean | null;
}

export interface PiotroskiBreakdownGroups {
  profitability: PiotroskiBreakdownProfitabilityGroup;
  leverageLiquidity: PiotroskiBreakdownLeverageLiquidityGroup;
  operatingEfficiency: PiotroskiBreakdownOperatingEfficiencyGroup;
}

/**
 * The 9 underlying boolean signals behind the persisted Piotroski F-Score (piotroskiFScore.Q), grouped
 * into the 3 categories web-nuxt's stock-detail page shows them under (獲利能力/財務韌性/營運周轉) — backs
 * splitting the existing single 9-point badge into 3 separate per-category badges. Confirmed with
 * analysis-ts directly (2026-09-10) via a real 2330 example.
 */
export interface PiotroskiBreakdownResult {
  symbol: string;
  /** false for an unknown symbol or a year/season with no data — still a 200, not a 404. */
  found: boolean;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  /** "YYYY-MM-DD", null when found is false. */
  knowledgeDate: string | null;
  knowledgeDateIsFallback: boolean | null;
  /**
   * Follows the same all-or-null rule as the persisted piotroskiFScore.Q — one missing underlying signal
   * nulls the whole score, analysis-ts does not partially compute it. bff-ts does NOT derive this itself
   * (pure pass-through); web-nuxt sums each group's own booleans into its own 4/3/2-denominator sub-score,
   * applying the same null-propagation rule per group.
   */
  totalScore: number | null;
  /** null (not an object of nulls) when found is false — same convention as financial-statement's statement field. */
  groups: PiotroskiBreakdownGroups | null;
}
