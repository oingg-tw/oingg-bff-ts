export interface SecurityListEntry {
  symbol: string;
  name: string;
}

/**
 * Unified search index across common stocks + TWSE preferred stocks + all ETFs, sourced from
 * analysis-ts's GET /securities (added 2026-09-11 to replace web-nuxt's previous 3-source merge:
 * GET /stocks + GET /stocks/preferred-stocks + POST /etf-screener). No type/market discriminator field —
 * analysis-ts doesn't expose one on this endpoint (confirmed live: entries are plain {symbol,
 * companyName}), per feedback_proxy_apis_no_transformation (don't invent fields analysis-ts doesn't
 * send) — a caller needing to tell common/preferred/ETF apart for routing must ask analysis-ts to add
 * one rather than bff-ts guessing from the symbol shape.
 */
export interface SecurityListResult {
  /** Total count across the whole index, independent of this page's size — use it to know when to stop paginating. */
  count: number;
  limit: number;
  offset: number;
  entries: SecurityListEntry[];
}
