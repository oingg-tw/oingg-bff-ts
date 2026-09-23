import type { MetricCategory } from "@/application/metricCatalog/metricCatalog.types.js";

/**
 * 指標型錄的對外取得 port（analysis-ts 的 GET /metrics）。實作住
 * infrastructure/analysisApi/metricCatalog/metricCatalog.client.ts。
 *
 * 跟 MacroGatewayPort 同一個慣例：一個切片一個 gateway，方法名用領域語彙而不是端點路徑。實作端負責把
 * analysis-ts 的 pitMetrics 原生形狀翻譯成這裡的 MetricCategory，並在回應不成形時丟 502——application
 * 只拿得到「已經是我們的形狀」的值。
 *
 * 只有拉、沒有推：analysis-ts（數據中台）不得知道 bff-ts 存在，所以跨服務同步一律由 bff-ts 發起
 * （見 [[feedback_analysis_ts_must_not_know_bff_exists.md]]）。這個 port 只有一個方向不是偶然。
 */
export interface MetricCatalogGatewayPort {
  fetchCatalog(): Promise<MetricCategory[]>;
}
