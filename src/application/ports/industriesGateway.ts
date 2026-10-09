import type {
  SecuritiesSectorList,
  SectorDividendSummary,
  SectorMetricHistory,
  SectorMonthlyRevenueHistory,
  SectorSummary,
} from "@/application/proxy/industries/industries.types.js";

/**
 * 產業分類的對外取得 port（analysis-ts 的 GET /industries/*）。實作住
 * infrastructure/analysisApi/industries/industries.client.ts。
 *
 * 一個切片一個 port，理由同 MacroGatewayPort。
 *
 * 這裡**曾經**同時放了兩套互不相干的分類法——gov-ts 的財政部稅籍五層產業樹（tree/flat）與證交所自己的
 * 類股（securities-sectors）——理由是它們來自同一支上游服務的同一個路徑前綴。2026-10-02 前者整組下架
 * （gov-ts 退役那組表），所以這個 port 現在只剩證交所類股那一套，而「一個切片一個 port」的理由也從
 * 「把兩套分類法擺在一起看」變成單純的切片邊界。
 */
export interface IndustriesGatewayPort {
  getSecuritiesSectors(): Promise<SecuritiesSectorList>;
  getSectorDividendSummary(): Promise<SectorDividendSummary>;
  getSectorMetricHistory(sectorCode: string, metricCode: string, basis: string, limit?: number): Promise<SectorMetricHistory>;
  getSectorMonthlyRevenueHistory(sectorCode: string, limit?: number): Promise<SectorMonthlyRevenueHistory>;
  getSectorSummary(fields: string): Promise<SectorSummary>;
}
