import type { SecurityListResult } from "@/application/proxy/securities/securities.types.js";

/**
 * 有價證券總表（普通股＋特別股＋ETF 的統一搜尋索引）的對外取得 port（analysis-ts 的 GET /securities）。
 * 實作住 infrastructure/analysisApi/securities/securities.client.ts。
 *
 * 目前只有一個方法，還是照「一個切片一個 port」放成獨立檔案而不是塞進別人家：切片邊界是照上游合約切的，
 * 不是照方法數量切的——這支端點日後長出 query/type 過濾時，會長在這裡。
 *
 * limit/offset 用 optional 而不是預設值：兩個都只在呼叫端真的給了才送出，上游才會套用它自己的預設值
 * （limit 200、offset 0），裸呼叫的回應跟分頁參數存在之前逐 byte 相同（見 securities.client.ts）。
 */
export interface SecuritiesGatewayPort {
  getSecurityList(limit?: number, offset?: number): Promise<SecurityListResult>;
}
