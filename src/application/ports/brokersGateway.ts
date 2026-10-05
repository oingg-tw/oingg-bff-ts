import type { BrokerList } from "@/application/proxy/brokers/brokers.types.js";

/**
 * 券商名單的對外取得 port（analysis-ts 的 GET /brokers，給 web-nuxt 持股頁的券商下拉選單用）。
 * 實作住 infrastructure/analysisApi/brokers/brokers.client.ts。
 *
 * 只有一個方法，照 securitiesGateway 的慣例仍然是獨立的切片：切片邊界照上游合約切，不照方法數量切。
 */
export interface BrokersGatewayPort {
  getBrokers(): Promise<BrokerList>;
}
