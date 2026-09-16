export type BetaTimeframe = "1Y_1D" | "2Y_1W" | "3Y_1W" | "5Y_1M";

export interface BetaWindow {
  timeframe: BetaTimeframe;
  /** Null when analysis-ts couldn't compute this window for the symbol (see nullReason) — an unknown/not-yet-backfilled symbol comes back with every window null, not a 404. */
  value: number | null;
  nullReason: string | null;
  /** The trading day this beta figure is as-of — null alongside value when this window has no data. */
  tradeDate: string | null;
  knowledgeDate: string | null;
  knowledgeDateIsFallback: boolean | null;
}

/**
 * A symbol's Beta coefficient across all of analysis-ts's fixed windows — added 2026-09-14 for
 * web-nuxt's StockBetaComparisonChart.vue, which previously only showed the price comparison line
 * without the actual Beta number. analysis-ts added a 4th window, 3Y_1W (between 2Y_1W and 5Y_1M), on
 * 2026-09-16 without notice — caught live when bff-ts's own strict-timeframe-enum validation started
 * 502ing on every /companies/beta call, which likely explains a "1Y beta insufficient data" report from
 * a 2330 user (see beta.client.ts's isBetaTimeframe/normalizeWindow). Always exactly 4 windows in this
 * fixed order, unlike this domain's other history endpoints which paginate a variable-length series.
 */
export interface BetaResult {
  symbol: string;
  windows: BetaWindow[];
}
