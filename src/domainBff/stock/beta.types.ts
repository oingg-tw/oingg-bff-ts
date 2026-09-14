export type BetaTimeframe = "1Y_1D" | "2Y_1W" | "5Y_1M";

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
 * A symbol's Beta coefficient across all 3 of analysis-ts's fixed windows (1Y_1D/2Y_1W/5Y_1M) — added
 * 2026-09-14 for web-nuxt's StockBetaComparisonChart.vue, which previously only showed the price
 * comparison line without the actual Beta number. Always exactly 3 windows in this fixed order, unlike
 * this domain's other history endpoints which paginate a variable-length series.
 */
export interface BetaResult {
  symbol: string;
  windows: BetaWindow[];
}
