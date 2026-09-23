import type {
  EtfColumnRef,
  EtfFieldCatalog,
  EtfScreenerFilter,
  EtfScreenerResult,
  EtfScreenerSort,
} from "@/application/proxy/etfScreener/etfScreener.types.js";

/**
 * ETF 篩選器的對外取得 port（analysis-ts 的 GET /etf-screener/filters 與 POST /etf-screener）。實作住
 * infrastructure/analysisApi/etfScreener/etfScreener.client.ts。
 *
 * 一個切片一個 port，理由同 MacroGatewayPort。
 *
 * 這個切片沒有本地型錄快取：欄位存不存在、filter 形狀對不對（numeric 的 min/max vs categorical 的
 * values）全由 analysis-ts 判定並回 400，bff-ts 原樣轉達。唯一留在 etfScreener.service.ts 的本地規則是
 * 「filters 與 columns 不能同時為空」，那是一個不用往返就能失敗的快速檢查。
 *
 * `sort` 用 optional：省略時不送 sortField/sortOrder，上游才會維持它自己的預設排序。
 */
export interface EtfScreenerGatewayPort {
  getFieldCatalog(): Promise<EtfFieldCatalog>;
  runScreener(
    filters: EtfScreenerFilter[],
    columns: EtfColumnRef[],
    page: number,
    pageSize: number,
    sort?: EtfScreenerSort,
  ): Promise<EtfScreenerResult>;
}
