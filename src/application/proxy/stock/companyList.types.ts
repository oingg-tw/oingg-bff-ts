export interface CompanyListEntry {
  symbol: string;
  name: string;
  /** "TWSE" (上市) or "TPEx" (上櫃) — added 2026-09-19, for web-nuxt's SEO content thickening. */
  market: string;
  /** 證交所類股代碼（見 GET /industries/securities-sectors），null if analysis-ts hasn't classified this company yet. */
  sectorCode: string | null;
  sectorName: string | null;
  /**
   * 是否為興櫃公司 — added by analysis-ts 2026-09-23, always present (never null). The directory
   * deliberately includes 興櫃 (the user's call: a future business line may target them), so this flag is
   * how a caller separates them: 2,349 total = 363 興櫃 + 1,986 上市櫃, and every other service's
   * "全市場" means the latter (mops-ts counts 1,985; the one-company gap is a de-duplication boundary).
   * **Subtract isEmerging=true before using this directory as a coverage denominator** — 興櫃 的揭露義務
   * 只有半年報與年報，所以**單季（Q）指標永久為空**，而需要行情的指標（peRatio、altmanZScore、beta…）
   * 也永久為空，上游沒有興櫃的行情資料。
   *
   * **但「沒有月營收」不等於「沒有營收」**——這一句原本寫成「任何由營收衍生的指標對興櫃永久為 null」，
   * 2026-10-01 實測推翻了後半：月營收確實沒有（`monthly-revenue-history` 對興櫃回 0 筆），可是半年報供得出
   * 營收，所以 `grossMargin.TTM` 有值（1293 = 32.87、1343 = 19.59）。機制對、結論推太遠了。
   *
   * 2026-10-01 上游完成興櫃半年頻回填（112Q2~115Q2、361 家）之後，興櫃**會出現在近四季的排名與分布裡**
   * （實測 roe.TTM 有值 2,237 家，前 200 名裡 13 家是興櫃）。注意**興櫃的近一年 ROE 分母用 3 個時點平均、
   * 上市櫃用 5 個**（興櫃只有半年報），所以同一張排名混著兩種算法。
   *
   * 想要排除興櫃的逐類股家數，`GET /industries/sector-dividend-summary` 的 `companyCount` 就是
   * （實測 34 個類股逐一相符，合計 1,976 ＝ 1,986 減掉 10 家 sectorCode 為 null 的 DR）。
   */
  isEmerging: boolean;
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
