export interface AnalysisMetricTable {
  /** Table name in the analysis Neon DB (ANALYSIS_DATABASE_URL). */
  table: string;
  /** Column to sort by (desc) to pick each symbol's single latest row. */
  latestOrderColumn: string;
  /** Extra WHERE applied before picking the latest row per symbol (e.g. consolidated, non-subsidiary only). */
  latestFilter?: string;
  /**
   * How to render the row's "as of" value for callers. "date" (default): format latestOrderColumn as
   * YYYY-MM-DD — used for daily/technical/point-in-time tables where a specific trading day IS the
   * meaningful granularity. "quarter": this table has its own `year`/`season` integer columns (every
   * quarterly-report table does, as part of its primary key) — select those directly and render
   * "{2-digit year}Q{season}" (e.g. "26Q2") instead, since which fiscal quarter a number is from is more
   * useful to a user than its exact period-end date, and the two integer columns are a more direct source
   * than parsing them back out of report_date.
   */
  asOfFormat?: "date" | "quarter";
}

/** Quarterly-report metric tables: keyed by symbol+year+season+dataType+subsidiaryCompanyId, report_date is the period end. Screening uses the latest consolidated (dataType='2'), parent-company (no subsidiary) row per symbol. */
const CONSOLIDATED_PARENT_ONLY = "data_type = '2' AND subsidiary_company_id = ''";

function quarterly(table: string): AnalysisMetricTable {
  return { table, latestOrderColumn: "report_date", latestFilter: CONSOLIDATED_PARENT_ONLY, asOfFormat: "quarter" };
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
 * groups them, so this is a rename/split of catalog keys, not a new backing table per key.
 *
 * altmanZScore/piotroskiFScore/beta wired up 2026-08-30 (needed for the PresetTemplate seed data —
 * see src/domains/screener/presetTemplates.ts) after verifying their real tables/columns. beta is
 * market-derived (no quarterly report behind it — no data_type/subsidiary_company_id columns, keyed by
 * as_of_date instead of report_date), so it uses its own inline table def rather than quarterly()/daily().
 *
 * nissimPenmanRnoa wired up 2026-08-31 on demand (a real screener/column request hit the "isn't wired up
 * yet" 501). Ordinary quarterly() table — verified guru_nissim_penman_rnoa's real columns via
 * information_schema (rnoa_quarterly_pct, rnoa_quarterly_annualized_pct, rnoa_ttm_pct, flev,
 * nbc_quarterly_pct, nbc_ttm_pct, spread_quarterly_pct, spread_ttm_pct, reconstructed_roe_quarterly_pct,
 * reconstructed_roe_ttm_pct, actual_roe_quarterly_pct, actual_roe_ttm_pct — all plain camelCase->snake_case,
 * no digit-suffix edge case like beta1Y).
 *
 * ma/rsi/kd/bollingerBands/atr/bias/macd wired up 2026-08-31 on demand (same "isn't wired up yet" 501,
 * this time for atr — reported by a real user via oingg-analysis-ts). All seven are daily() tables keyed
 * by symbol+trade_date, verified via information_schema. Field keys with a digit-window suffix
 * (ma5d/ma200d, rsi6d/rsi14d/rsi24d, k9d/d9d/k14d/d14d, atr14d/atr20d, bias5d/bias20d/bias60d) convert
 * cleanly through toSnakeCase's existing lowercase-letter+digit rule (e.g. ma5d -> ma_5d, atr14d ->
 * atr_14d) — no new edge case, same rule that already handled beta1Y.
 *
 * evEbitda/pFcf/psr/ohlsonOScore/zmijewskiScore still have real tables in the catalog but aren't wired
 * up here — none of the seeded preset templates (screener filter presets or column presets) need them
 * yet; wire up on demand rather than guessing ahead of an actual use.
 *
 * dupont wired up 2026-09-01 on demand (needed for analysis-ts's "profitabilityQuality"/獲利品質拆解
 * columnPreset). Ordinary quarterly() table (profitability_dupont), verified via information_schema —
 * plain camelCase->snake_case throughout (netProfitMarginQuarterly -> net_profit_margin_quarterly,
 * assetTurnoverQuarterly -> asset_turnover_quarterly, equityMultiplier -> equity_multiplier,
 * decomposedRoeQuarterlyPct -> decomposed_roe_quarterly_pct), no digit-suffix edge case.
 *
 * beneishMScore wired up 2026-09-01 on demand (a real "isn't wired up yet" 501, hit via analysis-ts's
 * "financialHealth"/財務體質排雷 columnPreset, which references beneishMScore.mScore). Ordinary
 * quarterly() table (guru_beneish_m_score), verified via information_schema — mScore -> m_score, no
 * digit-suffix edge case.
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
  altmanZScore: quarterly("guru_altman_z_score"),
  piotroskiFScore: quarterly("guru_piotroski_f_score"),
  beta: { table: "portfolio_beta", latestOrderColumn: "as_of_date" },
  nissimPenmanRnoa: quarterly("guru_nissim_penman_rnoa"),
  ma: daily("technicals_ma"),
  rsi: daily("technicals_rsi"),
  kd: daily("technicals_kd"),
  bollingerBands: daily("technicals_bollinger_bands"),
  atr: daily("technicals_atr"),
  bias: daily("technicals_bias"),
  macd: daily("technicals_macd"),
  dupont: quarterly("profitability_dupont"),
  beneishMScore: quarterly("guru_beneish_m_score"),
};
