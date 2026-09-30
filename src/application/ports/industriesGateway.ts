import type {
  IndustryFlatList,
  IndustryTree,
  SecuritiesSectorList,
  SectorDividendSummary,
} from "@/application/proxy/industries/industries.types.js";

/**
 * 產業分類的對外取得 port（analysis-ts 的 GET /industries/*）。實作住
 * infrastructure/analysisApi/industries/industries.client.ts。
 *
 * 一個切片一個 port，理由同 MacroGatewayPort。這裡刻意同時放了兩套互不相干的分類法——gov-ts 的五層
 * 稅籍產業樹（tree/flat）與證交所自己的類股（securities-sectors）——因為它們來自同一支上游服務的同一個
 * 路徑前綴；把「這個切片對 analysis-ts 要了哪些東西」擺在一起看，比按分類法拆兩個介面有用。
 *
 * `code` 用 optional 而不是預設值：省略時不送出該參數（上游回傳根節點），跟 macro 切片同一個理由。
 */
export interface IndustriesGatewayPort {
  getIndustryTree(code?: string): Promise<IndustryTree>;
  getIndustryFlatList(): Promise<IndustryFlatList>;
  getSecuritiesSectors(): Promise<SecuritiesSectorList>;
  getSectorDividendSummary(): Promise<SectorDividendSummary>;
}
