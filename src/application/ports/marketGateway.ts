import type {
  AttentionStocksResult,
  DisposedStocksResult,
  EtfRankingMetric,
  EtfRankingResult,
  MarginShortRatioRankingResult,
  MaterialAnnouncementsResult,
  PriceChangeRankingResult,
  PriceLimitRangeResult,
  RankingOrder,
  RevenueRankingMetric,
  RevenueRankingResult,
  TaiexDailyPriceInterval,
  TaiexDailyPriceResult,
  VolumeTop20Result,
} from "@/application/proxy/market/market.types.js";

/**
 * 大盤排行／市況清單的對外取得 port（analysis-ts 的 GET /market/*）。實作住
 * infrastructure/analysisApi/market/marketRankings.client.ts。
 *
 * 跟 MacroGatewayPort 同一個慣例：一個切片一個 port，不是一個端點一個 port——這 10 支端點來自同一個上游
 * 服務、同一份合約，合成一個介面才看得出「bff-ts 對 analysis-ts 的市況依賴面」有多大。
 *
 * 跟 macro 一樣沒有中間的 service 層（2026-09-28 刪掉）：limit 上下界與 metric/order 列舉驗證都在
 * http/modules/market/route.ts 的 zod schema，那份 schema 同時是 OpenAPI 的來源。
 *
 * `interval` 用 optional 而不是預設值——省略時不送出該參數，上游回應才會跟參數存在之前逐 byte 相同
 * （見 marketRankings.client.ts 的 fetchTaiexDailyPrice）。
 */
export interface MarketGatewayPort {
  getMarginShortRatioRanking(limit: number): Promise<MarginShortRatioRankingResult>;
  getMaterialAnnouncements(limit: number): Promise<MaterialAnnouncementsResult>;
  getRevenueRanking(metric: RevenueRankingMetric, order: RankingOrder, limit: number): Promise<RevenueRankingResult>;
  getVolumeTop20(): Promise<VolumeTop20Result>;
  getDisposedStocks(limit: number): Promise<DisposedStocksResult>;
  getAttentionStocks(limit: number): Promise<AttentionStocksResult>;
  getPriceLimitRange(): Promise<PriceLimitRangeResult>;
  getPriceChangeRanking(limit: number): Promise<PriceChangeRankingResult>;
  getEtfRanking(metric: EtfRankingMetric, order: RankingOrder, limit: number): Promise<EtfRankingResult>;
  getTaiexDailyPrice(limit: number, interval?: TaiexDailyPriceInterval): Promise<TaiexDailyPriceResult>;
}
