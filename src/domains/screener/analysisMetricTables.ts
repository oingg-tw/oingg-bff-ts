export interface AnalysisMetricTable {
  /** Table name in the analysis Neon DB (NEON_DB_ANALYSIS_URL). */
  table: string;
  /** Column to sort by (desc) to pick each symbol's single latest row. */
  latestOrderColumn: string;
  /** Extra WHERE applied before picking the latest row per symbol (e.g. consolidated, non-subsidiary only). */
  latestFilter?: string;
}

/** Quarterly-report metric tables: keyed by symbol+year+season+dataType+subsidiaryCompanyId, report_date is the period end. Screening uses the latest consolidated (dataType='2'), parent-company (no subsidiary) row per symbol. */
const CONSOLIDATED_PARENT_ONLY = "data_type = '2' AND subsidiary_company_id = ''";

function quarterly(table: string): AnalysisMetricTable {
  return { table, latestOrderColumn: "report_date", latestFilter: CONSOLIDATED_PARENT_ONLY };
}

/**
 * Maps each filterCatalog metric key to the table that stores its computed values in
 * oingg-analysis-ts's own "analysis" Neon DB. Verified 2026-08-25 against the real DB schema
 * (information_schema.tables) — NOT a mechanical function of category+metric key, since a couple of
 * table names collapse a redundant prefix (e.g. cashFlowPerShare -> cash_flow_per_share, not
 * cash_flow_cash_flow_per_share). Update this whenever oingg-analysis-ts ships a new metric —
 * a metric missing here fails screener/column requests with a clear 501, not a crash.
 */
export const ANALYSIS_METRIC_TABLES: Record<string, AnalysisMetricTable> = {
  accrualsRatio: quarterly("cash_flow_accruals_ratio"),
  cashFlowPerShare: quarterly("cash_flow_per_share"),
  ocfToNetIncome: quarterly("cash_flow_ocf_to_net_income"),
  grahamNumber: quarterly("guru_graham_number"),
  ncav: quarterly("guru_ncav"),
  ownerEarnings: quarterly("guru_owner_earnings"),
  bvps: quarterly("profitability_bvps"),
  dividendPayoutRatio: quarterly("profitability_dividend_payout_ratio"),
  eps: quarterly("profitability_eps"),
  margins: quarterly("profitability_margins"),
  revenuePerShare: quarterly("profitability_revenue_per_share"),
  roa: quarterly("profitability_roa"),
  roce: quarterly("profitability_roce"),
  roe: quarterly("profitability_roe"),
  roic: quarterly("profitability_roic"),
  sgr: quarterly("profitability_sgr"),
  deRatio: quarterly("solvency_de_ratio"),
  debtRatio: quarterly("solvency_debt_ratio"),
  interestCoverage: quarterly("solvency_interest_coverage"),
  liquidityRatio: quarterly("solvency_liquidity_ratio"),
  netDebtToEbitda: quarterly("solvency_net_debt_to_ebitda"),
  capexToRevenue: quarterly("turnover_capex_to_revenue"),
  turnoverRatio: quarterly("turnover_ratio"),
  // Daily market data, not tied to a quarterly report — keyed by symbol+tradeDate instead.
  marketRatios: { table: "valuation_market_ratios", latestOrderColumn: "trade_date" },
};
