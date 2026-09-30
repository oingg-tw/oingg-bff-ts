export type IndustryLevel = "section" | "division" | "group" | "class" | "subclass";

export interface IndustryTreeChild {
  code: string;
  level: IndustryLevel;
  name: string;
  companyCount: number;
  /** True whenever the classification dictionary has children here, even if none of the 999 tracked
   * companies currently fall under this node (companyCount can be 0 while hasChildren is still true). */
  hasChildren: boolean;
}

export interface IndustryTreeCompany {
  symbol: string;
  companyName: string;
}

/**
 * A single flat shape regardless of `found` — analysis-ts confirmed all 7 fields are always present.
 * Querying the root (no code) returns `code`/`level`/`name` as null with `children` being the 19 top-level
 * sections. `found: false` (unknown code) echoes back the requested `code`, `level`/`name` null,
 * `children`/`companies` empty, `companyCount` 0 — same shape, not a different one.
 *
 * `companies` is only ever non-empty at the "subclass" level — all 999 tracked companies are classified
 * at that leaf level, so section/division/group/class nodes always have an empty `companies` array (not
 * a bug: avoids the same company appearing at every ancestor level). Scope is the ~999 companies gov-ts
 * tracks tax-registration classification for — excludes KY-registered (foreign) companies, which have no
 * Taiwan tax registration to classify against.
 */
export interface IndustryTree {
  found: boolean;
  code: string | null;
  level: IndustryLevel | null;
  name: string | null;
  companyCount: number;
  children: IndustryTreeChild[];
  companies: IndustryTreeCompany[];
}

export interface IndustryPathNode {
  code: string;
  level: IndustryLevel;
  name: string;
}

export interface IndustryFlatCompany {
  symbol: string;
  companyName: string;
  /** Coarsest to finest — section, division, group, class, subclass, always all 5 levels. */
  path: IndustryPathNode[];
}

/**
 * All 999 gov-ts-tracked companies' symbol -> full classification path, added 2026-09-09 so a caller
 * doesn't have to recursively crawl GET /industries/tree to build a symbol/keyword search index. Only
 * TWSE-listed companies have data so far (TPEx/興櫃 pending on gov-ts's side) — same scope as
 * GET /industries/tree, this is just a flattened view of the same tree.
 */
export interface IndustryFlatList {
  companies: IndustryFlatCompany[];
}

export interface SecuritiesSector {
  code: string;
  name: string;
  companyCount: number;
}

/**
 * TWSE/TPEx's own securities-sector classification (證交所類股 — e.g. "24" = 半導體業), a completely
 * separate scheme from the gov-ts tax-registration industry tree above (IndustryTree/IndustryFlatList).
 * Two-digit codes, used by the screener's sectorCodes filter (union semantics across multiple codes).
 */
export interface SecuritiesSectorList {
  sectors: SecuritiesSector[];
}

/**
 * 一個類股在一個指標上的統計。**`count` 是這張表最重要的欄位，不是附註**：它是「這個類股裡有多少家算得出
 * 這個指標」，而 mean/median 是對那 count 家算的，不是對 companyCount 家。
 *
 * `count` 為 0 時 mean 與 median 是 null（不會是 0）——上游明說的契約。2026-09-30 實測 34 個類股沒有任何
 * 一軸是 0，所以那條規則目前沒有活資料在驗證它；不要因為「看起來不會發生」就省掉 null 處理。
 */
export interface SectorMetricStats {
  count: number;
  mean: number | null;
  median: number | null;
}

/**
 * 類股層級的股利統計，一列一個證交所類股（sectorCode 同 SecuritiesSector.code）。用途是產業分析散佈圖：
 * 一軸殖利率、一軸三年股利成長率。
 *
 * **兩個軸的 count 不同，所以一個點的 x 與 y 是對不同子母體算的。** 2026-09-30 晚間實測 34 個類股（上游當天
 * 改了殖利率的空白處理，見最下面，所以**不要引用這一天早些時候量到的數字**）：
 *
 * ```
 * 殖利率軸   涵蓋率中位 100%，最低 98%，31/34 類股全滿   ← 幾乎不是瓶頸了
 * 成長率軸   綠能環保 n=5/46、油電燃氣業 n=2/12、數位雲端 n=8/40、半導體業 n=120/206
 * ```
 *
 * 所以**現在的稀疏軸只有成長率**。兩軸都有值的涵蓋率中位數 61.4%、最低 10.9%，10 個類股的成長率 n < 10，
 * 而油電燃氣業那 2 家的平均是 -45.87——把那個點跟 n=120 的點畫成同樣大小、同等權重會誤導。
 * **請用 count 做透明度、點大小或最小 n 門檻**（門檻取捨：n>=5 留 32 個類股、n>=10 留 24 個、n>=20 留 19 個、
 * n>=30 留 13 個）。唯一兩軸皆 100% 的是水泥工業（7/7）。
 *
 * **mean 與 median 在成長率這一軸有 7 個類股正負號相反**（食品工業、電機機械、建材營造業、電子零組件業、
 * 其他電子業、文化創意業、運動休閒），而成長率軸的正負號就是它要講的整句話（配息在成長還是在縮）。
 * 所以選 mean 或 median 不是美觀問題，會對 34 個類股裡的 7 個給出相反的結論。少數極端值就足以翻轉 mean
 * （造紙工業 mean -60.40 / median -44.97、玻璃陶瓷 -20.28 / -3.45）。
 *
 * ## 殖利率的 0 代表「不配息」，而它是母體的四分之一（2026-09-30 上游變更）
 *
 * 證交所從 2026-08-28 起對不配息的上市公司改成**不填**殖利率（之前填 0.00）。analysis-ts 於 2026-09-30
 * （commit c70cf5a0）決定把 8/28 起的空白讀成 0，所以**原本是 null 的那些公司現在是 0**。實測後果：
 *
 * ```
 * 殖利率恰為 0 的公司   516 家（母體 1,978 的 26%）；TPEx 279 + TWSE 236
 * 分布端點的 p20        0（excludeZero=false）
 * 34 個類股的殖利率 mean  全部下移，平均 -0.97 個百分點，最多 -2.59（文化創意業 6.11 -> 3.52）
 * 移動最大的是不配息最多的類股   生技醫療業 n 95 -> 159（多了 64 家 0%），mean 4.26 -> 2.54
 * ```
 *
 * **這個方向是對的而不是壞掉**：先前「生技醫療業平均殖利率 4.26%」是只對會配息的 95 家算的，忽略了不配息的
 * 64 家；2.54% 才是「這個類股典型的殖利率」。但它是**另一個量**，而且 formulaVersion 不升（取數規則變更
 * 不升版，見 stock/openapi.ts 的 VERSION_FIELD_DOC），所以任何快取或截圖過舊值的人只會看到數字無聲變小。
 *
 * 一個下游必須知道的界線：**0 與「算不出來」現在無法區分**。0% 是一個完全合理的座標值，不會長得像缺值，
 * 所以散佈圖上貼著 y 軸的那一排點是「不配息」而不是「資料有問題」。造紙工業的殖利率 median 就是 0
 * （7 家裡過半不配息），那個類股的點會落在軸上。
 *
 * 母體是上市加上櫃、不含興櫃（上游說明），2026-09-30 實測 companyCount 合計 1,976。
 * 這跟 [[reference_screener_population]] 記的全市場 2,349 不同，別把兩個數字當同一個母體比較。
 */
export interface SectorDividendSummary {
  /** 殖利率取自哪一天的收盤（"YYYY-MM-DD"）。整份回應共用一個日期，不是逐類股。 */
  dividendYieldTradeDate: string | null;
  sectors: SectorDividendSummaryRow[];
}

export interface SectorDividendSummaryRow {
  sectorCode: string;
  sectorName: string;
  /** 這個類股的公司家數。**mean/median 的分母不是它**，是各軸自己的 count。 */
  companyCount: number;
  dividendYield: SectorMetricStats;
  dividendGrowthRate3y: SectorMetricStats;
}
