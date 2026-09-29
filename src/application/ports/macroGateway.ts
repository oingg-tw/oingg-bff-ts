import type {
  BusinessCycleIndicatorResult,
  CbcPolicyRateResult,
  UsPolicyRateResult,
  CpiCategory,
  CpiResult,
  GdpCategory,
  GdpResult,
  GovBondYield10yHistoryResult,
  GovBondYield10yResult,
  MonetaryAggregateResult,
  StockMarketSummaryResult,
  UsdTwdRateInterval,
  UsdTwdRateResult,
} from "@/application/proxy/macro/macro.types.js";

/**
 * 總經序列的對外取得 port（analysis-ts 的 GET /macro/*）。實作住
 * infrastructure/analysisApi/macro/macro.client.ts。
 *
 * 代理切片刻意是「一個切片一個 port」而不是「一個端點一個 port」：這 9 支端點來自同一個上游服務、同一份
 * 合約，拆成 9 個介面只會製造儀式感，合成一個反而讓「bff-ts 對 analysis-ts 的依賴面」一眼看得完。
 *
 * 選填參數一律用 optional 而不是預設值——省略時不送出該參數，上游回應才會跟參數存在之前逐 byte 相同
 * （見 macro.client.ts 的註解）。
 */
export interface MacroGatewayPort {
  getCbcPolicyRate(from?: string): Promise<CbcPolicyRateResult>;
  getUsPolicyRate(from?: string): Promise<UsPolicyRateResult>;
  getBusinessCycleIndicator(from?: string): Promise<BusinessCycleIndicatorResult>;
  getMonetaryAggregate(from?: string): Promise<MonetaryAggregateResult>;
  getGovBondYield10y(): Promise<GovBondYield10yResult>;
  getGovBondYield10yHistory(from?: string): Promise<GovBondYield10yHistoryResult>;
  getStockMarketSummary(from?: string): Promise<StockMarketSummaryResult>;
  getUsdTwdRate(limit?: number, interval?: UsdTwdRateInterval): Promise<UsdTwdRateResult>;
  getCpi(from?: string, category?: CpiCategory): Promise<CpiResult>;
  getGdp(from?: string, category?: GdpCategory): Promise<GdpResult>;
}
