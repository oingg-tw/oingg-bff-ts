export interface AnalysisMetricTable {
  /** Table name in the analysis Neon DB (ANALYSIS_DATABASE_URL). */
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

/** Daily market data, not tied to a quarterly report — keyed by symbol+tradeDate instead of report_date. */
function daily(table: string): AnalysisMetricTable {
  return { table, latestOrderColumn: "trade_date" };
}

/**
 * Maps each filterCatalog metric key to the table that stores its computed values in
 * oingg-analysis-ts's own "analysis" Neon DB. Verified against the real DB schema
 * (information_schema.tables/columns) — NOT a mechanical function of category+metric key, since a
 * couple of table names collapse a redundant prefix (e.g. cashFlowPerShare -> cash_flow_per_share, not
 * cash_flow_cash_flow_per_share), and several metric *keys* below intentionally share one table (the
 * catalog exposes fine-grained metrics like "per"/"pbr"/"dividendYield" that are really just different
 * columns of the same underlying computed row, e.g. valuation_market_ratios). Update this whenever
 * oingg-analysis-ts ships a new metric or reshapes the catalog — a metric missing here fails
 * screener/column requests with a clear 501, not a crash.
 *
 * Re-verified 2026-08-30 after oingg-analysis-ts split several previously-grouped catalog metrics into
 * more granular ones (margins -> grossMargin/operatingMargin/netProfitMargin, marketRatios ->
 * per/pbr/dividendYield, liquidityRatio -> currentRatio/quickRatio/cashRatio, turnoverRatio -> five
 * *TurnoverRatio metrics plus four new *Days/cashConversionCycle metrics, cashFlowPerShare ->
 * ocfPerShare/fcfPerShare) — the underlying tables and columns didn't change, only how the catalog
 * groups them, so this is a rename/split of catalog keys, not a new backing table per key. A handful of
 * genuinely new metrics (technical indicators, quant scores: rsi/macd/beta/altmanZScore/etc.) also
 * appeared in the catalog with real tables now (technicals_*, guru_*, portfolio_beta, valuation_ev_ebitda
 * /p_fcf/psr, profitability_dupont) but aren't wired up here yet — deliberately out of scope for this
 * pass, they correctly 501 rather than being guessed at.
 */
export const ANALYSIS_METRIC_TABLES: Record<string, AnalysisMetricTable> = {
  accrualsRatio: quarterly("cash_flow_accruals_ratio"),
  ocfPerShare: quarterly("cash_flow_per_share"),
  fcfPerShare: quarterly("cash_flow_per_share"),
  ocfToNetIncome: quarterly("cash_flow_ocf_to_net_income"),
  grahamNumber: quarterly("guru_graham_number"),
  ncav: quarterly("guru_ncav"),
  ownerEarnings: quarterly("guru_owner_earnings"),
  bvps: quarterly("profitability_bvps"),
  dividendPayoutRatio: quarterly("profitability_dividend_payout_ratio"),
  eps: quarterly("profitability_eps"),
  grossMargin: quarterly("profitability_margins"),
  operatingMargin: quarterly("profitability_margins"),
  netProfitMargin: quarterly("profitability_margins"),
  revenuePerShare: quarterly("profitability_revenue_per_share"),
  roa: quarterly("profitability_roa"),
  roce: quarterly("profitability_roce"),
  roe: quarterly("profitability_roe"),
  roic: quarterly("profitability_roic"),
  sgr: quarterly("profitability_sgr"),
  deRatio: quarterly("solvency_de_ratio"),
  debtRatio: quarterly("solvency_debt_ratio"),
  interestCoverage: quarterly("solvency_interest_coverage"),
  currentRatio: quarterly("solvency_liquidity_ratio"),
  quickRatio: quarterly("solvency_liquidity_ratio"),
  cashRatio: quarterly("solvency_liquidity_ratio"),
  netDebtToEbitda: quarterly("solvency_net_debt_to_ebitda"),
  capexToRevenue: quarterly("turnover_capex_to_revenue"),
  inventoryTurnoverRatio: quarterly("turnover_ratio"),
  receivablesTurnoverRatio: quarterly("turnover_ratio"),
  assetTurnoverRatio: quarterly("turnover_ratio"),
  fixedAssetTurnoverRatio: quarterly("turnover_ratio"),
  payablesTurnoverRatio: quarterly("turnover_ratio"),
  inventoryDays: quarterly("turnover_ratio"),
  receivablesDays: quarterly("turnover_ratio"),
  payablesDays: quarterly("turnover_ratio"),
  cashConversionCycle: quarterly("turnover_ratio"),
  per: daily("valuation_market_ratios"),
  pbr: daily("valuation_market_ratios"),
  dividendYield: daily("valuation_market_ratios"),
};
