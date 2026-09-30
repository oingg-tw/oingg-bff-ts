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
 * **兩個軸的 count 不同，所以一個點的 x 與 y 是對不同子母體算的。** 2026-09-30 實測 34 個類股：
 *
 * ```
 * 綠能環保    46 家   殖利率 n=38   成長 n=5    ← y 座標是 5 家的平均
 * 油電燃氣業  12 家   殖利率 n=12   成長 n=2    ← y 是 2 家的平均，值 -45.87
 * 半導體業   206 家   殖利率 n=161  成長 n=120
 * 水泥工業     7 家   殖利率 n=7    成長 n=7    ← 唯一兩軸皆 100% 的類型
 * ```
 *
 * 兩軸都有值的涵蓋率中位數只有 60%，最低 10.9%，而 10 個類股至少一軸的 n < 10。把這些點跟 n=161 的點
 * 畫成同樣大小、同等權重會誤導——**請用 count 做透明度、點大小或最小 n 門檻**。門檻的取捨（實測）：
 * n>=5 留 30 個類股、n>=10 留 24 個、n>=20 留 19 個、n>=30 留 13 個。
 *
 * **mean 與 median 在成長率這一軸有 7 個類股正負號相反**（食品工業、電機機械、建材營造業、電子零組件業、
 * 其他電子業、文化創意業、運動休閒），而成長率軸的正負號就是它要講的整句話（配息在成長還是在縮）。
 * 所以選 mean 或 median 不是美觀問題，會對 34 個類股裡的 7 個給出相反的結論。少數極端值就足以翻轉 mean
 * （造紙工業 mean -60.40 / median -44.97、玻璃陶瓷 -20.28 / -3.45）。
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
