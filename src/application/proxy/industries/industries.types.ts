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
 * 原始資料的兩個交易所本來就不對稱（analysis-ts 實測 8/28 起）：上櫃 17,743 列裡殖利率 null 是 **0 列**、
 * 0 有 5,525 列；上市同期 null 有 4,890 列、0 是 **0 列**。也就是**櫃買中心從來沒有改寫法**，只有證交所改了，
 * 而上面那個讀取端規則把兩邊都正規化成 0。
 *
 * **不要把殖利率軸讀成「曾經稀疏、後來補齊」。** 這支端點上線後的第一個小時有一個暫時規則「殖利率只算大於
 * 0」，把上櫃那 279 家 0 也排除了；當時量到的低涵蓋率（例如綠能環保 n=38/46、半導體業 n=161/206）是那個
 * 規則的產物，不是真實狀態。c70cf5a0 同時拿掉該規則（+279 上櫃）並修正上市（+236）。**現在的 100% 才是常態，
 * 不會再退回去。** 這件事的一般教訓：新端點上線後幾小時內量到的數字可能是暫態，引用前先確認它穩定了。
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
 * 全市場目錄 2026-10-02 起是 2,339 家（上游移除 10 檔 DR 之後），所以這個 1,976 的差額就是 363 家興櫃，不再有 DR 那一項。
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

/**
 * 類股的指標分布歷史（analysis-ts GET /industries/{sectorCode}/metric-history，2026-10-09 起代理）。每一期是同一期
 * 對齊、排除興櫃的上市櫃公司在這支指標上的分布；只收季報型、非每股類指標（每股類跨公司取中位數沒有意義，上游回 400）。
 * 原樣轉發，`basis` 是上游的 `timeframe`（跟業務中台其他歷史端點同名）。
 */
export interface SectorMetricHistory {
  sectorCode: string;
  sectorName: string;
  metricCode: string;
  basis: string;
  /** 由舊到新。 */
  entries: SectorMetricHistoryEntry[];
}

export interface SectorMetricHistoryEntry {
  fiscalYear: number;
  /** 年度（FY）列沒有季別，是 null。 */
  fiscalQuarter: number | null;
  /** 這一期有值、計入分布的公司數。 */
  count: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** 整個類股這一期算不出分布的原因（例如 not_applicable_industry）；有分布時是 null。 */
  nullReason: string | null;
}

/** 類股月營收歷史（GET /industries/{sectorCode}/monthly-revenue-history）。年增率用同一批公司計算。 */
export interface SectorMonthlyRevenueHistory {
  sectorCode: string;
  sectorName: string;
  total: number;
  hasMore: boolean;
  entries: SectorMonthlyRevenueEntry[];
}

export interface SectorMonthlyRevenueEntry {
  /** "YYYY-MM" */
  yearMonth: string;
  /** 新台幣千元，字串（大整數，跟 monthly-revenue-history 一樣）。 */
  revenue: string | null;
  lastYearRevenue: string | null;
  yoyChangePercent: number | null;
  companyCount: number;
}

/** 各類股的指標分布摘要（GET /industries/sector-summary?fields=…，最多 10 個欄位）。 */
export interface SectorSummary {
  sectors: SectorSummaryRow[];
}

export interface SectorSummaryRow {
  sectorCode: string;
  sectorName: string;
  companyCount: number;
  /** key 是請求的欄位（"roe.TTM"）。 */
  fields: Record<string, SectorFieldStats>;
}

export interface SectorFieldStats {
  count: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
}
