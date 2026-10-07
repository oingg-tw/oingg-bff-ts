import type { BetaResult } from "@/application/proxy/stock/beta.types.js";
import type { CapitalStockHistoryResult } from "@/application/proxy/stock/capitalStockHistory.types.js";
import type { CompanyBadgesResult } from "@/application/proxy/stock/companyBadges.types.js";
import type { CompanyListResult } from "@/application/proxy/stock/companyList.types.js";
import type { CompanyProfile } from "@/application/proxy/stock/companyProfile.types.js";
import type { DailyPriceHistoryResult } from "@/application/proxy/stock/dailyPriceHistory.types.js";
import type { DividendHistoryResult } from "@/application/proxy/stock/dividendHistory.types.js";
import type { BookValueBreakdownResult } from "@/application/proxy/stock/bookValueBreakdown.types.js";
import type { ValuationRiverRatio, ValuationRiverResult } from "@/application/proxy/stock/valuationRiver.types.js";
import type { DupontHistoryBasis, DupontHistoryResult } from "@/application/proxy/stock/dupontHistory.types.js";
import type { ExDividendCalendarEntry, ExDividendCalendarResult } from "@/application/proxy/stock/exDividendCalendar.types.js";
import type { FinancialStatementResult, FinancialStatementType } from "@/application/proxy/stock/financialStatement.types.js";
import type { ForeignShareholdingHistoryResult } from "@/application/proxy/stock/foreignShareholdingHistory.types.js";
import type { MetricHistoryBasis, MetricHistoryCode, MetricHistoryResult } from "@/application/proxy/stock/metricHistory.types.js";
import type { MetricProvenanceMetricCode, MetricProvenanceResult } from "@/application/proxy/stock/metricProvenance.types.js";
import type { MetricsHistoryResult } from "@/application/proxy/stock/metricsHistory.types.js";
import type { MonthlyRevenueHistoryResult } from "@/application/proxy/stock/monthlyRevenueHistory.types.js";
import type { PiotroskiBreakdownResult } from "@/application/proxy/stock/piotroskiBreakdown.types.js";
import type { PreferredStocksResult } from "@/application/proxy/stock/preferredStocks.types.js";
import type { PreferredStockFieldCatalogResult } from "@/application/proxy/stock/preferredStocksFieldCatalog.types.js";
import type { RoaHistoryResult, RoeHistoryResult, RoeRoaHistoryBasis } from "@/application/proxy/stock/roeRoaHistory.types.js";
import type { ClosePrice, StockQuote } from "@/application/proxy/stock/stock.types.js";

/**
 * 個股資料的對外取得 port（analysis-ts 的 GET /stocks/* 與 GET /companies/*）。實作散在
 * infrastructure/analysisApi/stock/ 底下的 20 支 client，由同目錄的 stock.gateway.ts 收成一個出口。
 *
 * 跟 MacroGatewayPort／MarketGatewayPort 同一個慣例：一個切片一個 port。差別只在這個 port 有 23 個方法，
 * 是全 repo 最大的一個——但那不是設計失誤，是誠實：analysis-ts 對「一檔股票」就是開了這麼多支端點
 * （報價、基本資料、badges、8 種歷史序列、財報、溯源……），這個介面的長度就等於 bff-ts 對上游個股 API
 * 的依賴面有多寬。拆成 23 個 port 不會讓依賴變少，只會讓它分散到 23 個檔案裡看不出總量；照端點分群拆成
 * 「報價 / 歷史 / 財報」三個 port 也只是換一種武斷的切法——上游沒有這個分界，bff-ts 不該自己發明一個。
 * 這裡會變短的唯一方式，是 analysis-ts 真的收掉端點（像 playwright-py 那批一樣），不是這邊重新分類。
 *
 * 選填參數一律用 optional 而不是預設值——省略時不送出該參數，上游回應才會跟參數存在之前逐 byte 相同
 * （各 client 的 `if (limit !== undefined)` 都是為了這件事，別「簡化」掉）。
 *
 * 回傳 `| null` 的兩支（getStockQuote／getCompanyProfile）是上游真的會 404 的端點，null 代表「查無此
 * 標的」而不是錯誤；其餘端點查無資料時回的是空陣列或 found:false，不是 404。要把 null 翻成 HTTP 404 的
 * 是呼叫端（route，或 stock.service.ts 的 assertSymbolExists），不是這一層。
 */
export interface StockGatewayPort {
  // --- 報價與清單 ---
  getCompanyList(limit?: number, offset?: number): Promise<CompanyListResult>;
  getStockQuote(symbol: string): Promise<StockQuote | null>;
  /** 批次收盤價。查無的標的直接不在 Map 裡，不會是 null——見 stockQuote.client.ts 的 fetchStockPrices。 */
  getLatestClosePrices(symbols: string[]): Promise<Map<string, ClosePrice>>;

  // --- 個股基本面 ---
  getCompanyProfile(symbol: string): Promise<CompanyProfile | null>;
  getBeta(symbol: string): Promise<BetaResult>;
  getCompanyBadges(symbol: string): Promise<CompanyBadgesResult>;
  getCapitalStockHistory(symbol: string): Promise<CapitalStockHistoryResult>;
  getDividendHistory(symbol: string): Promise<DividendHistoryResult>;
  getExDividendNotices(symbols: string[]): Promise<Map<string, ExDividendCalendarEntry[]>>;
  getExDividendCalendar(month: string): Promise<ExDividendCalendarResult>;
  getFinancialStatement(
    symbol: string,
    statementType: FinancialStatementType,
    year?: string,
    season?: string,
  ): Promise<FinancialStatementResult>;
  getPreferredStocks(symbol?: string): Promise<PreferredStocksResult>;
  getPreferredStockFieldCatalog(): Promise<PreferredStockFieldCatalogResult>;

  // --- 歷史序列。`basis` 是 bff-ts 自己的公開參數名，上游的線路參數名不同且改過數次（見各 client）。 ---
  getMetricHistory(
    symbol: string,
    metricCode: MetricHistoryCode,
    basis: MetricHistoryBasis,
    limit?: number,
  ): Promise<MetricHistoryResult>;
  getMetricsHistory(symbol: string, metricCodes: string[], basis: string, limit?: number): Promise<MetricsHistoryResult>;
  getRoeHistory(symbol: string, basis: RoeRoaHistoryBasis, limit?: number): Promise<RoeHistoryResult>;
  getRoaHistory(symbol: string, basis: RoeRoaHistoryBasis, limit?: number): Promise<RoaHistoryResult>;
  getDupontHistory(symbol: string, basis: DupontHistoryBasis, limit?: number): Promise<DupontHistoryResult>;

  /**
   * 每股淨值變動拆解，一年一列（analysis-ts 2026-09-27 新增）。沒有參數可調，上游給全部年度。
   * 每一列是恆等式：opening + 6 個變動項 = closing，驗它的容差要 0.02 不是 0.01（見型別說明）。
   */
  getBookValueBreakdown(symbol: string): Promise<BookValueBreakdownResult>;
  getValuationRiver(symbol: string, ratio: ValuationRiverRatio, lookbackYears?: number): Promise<ValuationRiverResult>;
  getMonthlyRevenueHistory(symbol: string, limit?: number): Promise<MonthlyRevenueHistoryResult>;
  getForeignShareholdingHistory(symbol: string, limit?: number): Promise<ForeignShareholdingHistoryResult>;
  getDailyPriceHistory(symbol: string, limit?: number): Promise<DailyPriceHistoryResult>;

  // --- 拆解與溯源 ---
  getPiotroskiBreakdown(symbol: string, year?: string, season?: string): Promise<PiotroskiBreakdownResult>;
  getMetricProvenance(
    symbol: string,
    metricCode: MetricProvenanceMetricCode,
    year?: string,
    season?: string,
    periodType?: string,
    asOfDate?: string,
  ): Promise<MetricProvenanceResult>;
}
