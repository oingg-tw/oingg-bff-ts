export type SecurityType = "COMMON" | "PREFERRED" | "ETF";

export interface SecurityListEntry {
  symbol: string;
  name: string;
  type: SecurityType;
}

/**
 * Unified search index across common stocks + TWSE preferred stocks + all ETFs, sourced from
 * analysis-ts's GET /securities (added 2026-09-11 to replace web-nuxt's previous 3-source merge:
 * GET /stocks + GET /stocks/preferred-stocks + POST /etf-screener). `type` added by analysis-ts
 * 2026-09-11 (commit 46df7ef) after web-nuxt needed a reliable way to route a search result to
 * /stock/{code} vs /preferred-stocks/{code} vs /etf-zone — bff-ts deliberately did not guess this from
 * the symbol shape itself (per feedback_proxy_apis_no_transformation), and asked analysis-ts to add it
 * as a real field instead.
 */
export interface SecurityListResult {
  /** Total count across the whole index, independent of this page's size — use it to know when to stop paginating. */
  count: number;
  limit: number;
  offset: number;
  entries: SecurityListEntry[];
}
