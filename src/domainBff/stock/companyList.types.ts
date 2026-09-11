export interface CompanyListEntry {
  symbol: string;
  name: string;
}

/**
 * Full-market company directory — every currently-listed TWSE/TPEx company's symbol/name, sourced from
 * twse-ts/tpex-ts's own company_profile tables (TWSE preferred on a symbol collision, per analysis-ts).
 * No market-type (上市/上櫃) field — analysis-ts doesn't expose one on this endpoint; add one later if a
 * real need for it shows up, per feedback_proxy_apis_no_transformation (don't invent fields analysis-ts
 * doesn't send).
 */
export interface CompanyListResult {
  /** Total company count across the whole market, independent of this page's size — use it to know when to stop paginating. */
  count: number;
  limit: number;
  offset: number;
  entries: CompanyListEntry[];
}
