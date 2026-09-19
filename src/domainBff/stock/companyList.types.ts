export interface CompanyListEntry {
  symbol: string;
  name: string;
  /** "TWSE" (上市) or "TPEx" (上櫃) — added 2026-09-19, for web-nuxt's SEO content thickening. */
  market: string;
  /** 證交所類股代碼（見 GET /industries/securities-sectors），null if analysis-ts hasn't classified this company yet. */
  sectorCode: string | null;
  sectorName: string | null;
}

/**
 * Full-market company directory — every currently-listed TWSE/TPEx company's symbol/name/market/sector,
 * sourced from twse-ts/tpex-ts's own company_profile tables (TWSE preferred on a symbol collision, per
 * analysis-ts). market/sectorCode/sectorName landed 2026-09-19 (previously analysis-ts sent neither —
 * see feedback_proxy_apis_no_transformation, don't invent fields analysis-ts doesn't send; these are now
 * real upstream fields, not invented here).
 */
export interface CompanyListResult {
  /** Total company count across the whole market, independent of this page's size — use it to know when to stop paginating. */
  count: number;
  limit: number;
  offset: number;
  entries: CompanyListEntry[];
}
