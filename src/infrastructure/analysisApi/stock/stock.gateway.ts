import type { StockGatewayPort } from "@/application/ports/stockGateway.js";
import { fetchBeta } from "@/infrastructure/analysisApi/stock/beta.client.js";
import { fetchCapitalStockHistory } from "@/infrastructure/analysisApi/stock/capitalStockHistory.client.js";
import { fetchCompanyBadges } from "@/infrastructure/analysisApi/stock/companyBadges.client.js";
import { fetchCompanyList } from "@/infrastructure/analysisApi/stock/companyList.client.js";
import { fetchCompanyProfile } from "@/infrastructure/analysisApi/stock/companyProfile.client.js";
import { fetchDailyPriceHistory } from "@/infrastructure/analysisApi/stock/dailyPriceHistory.client.js";
import { fetchDividendHistory } from "@/infrastructure/analysisApi/stock/dividendHistory.client.js";
import { fetchBookValueBreakdown } from "@/infrastructure/analysisApi/stock/bookValueBreakdown.client.js";
import { fetchValuationRiver } from "@/infrastructure/analysisApi/stock/valuationRiver.client.js";
import { fetchDupontHistory } from "@/infrastructure/analysisApi/stock/dupontHistory.client.js";
import { fetchExDividendCalendar } from "@/infrastructure/analysisApi/stock/exDividendCalendar.client.js";
import { fetchExDividendNotices } from "@/infrastructure/analysisApi/stock/exDividendNotices.client.js";
import { fetchFinancialStatement } from "@/infrastructure/analysisApi/stock/financialStatement.client.js";
import { fetchForeignShareholdingHistory } from "@/infrastructure/analysisApi/stock/foreignShareholdingHistory.client.js";
import { fetchMetricHistory } from "@/infrastructure/analysisApi/stock/metricHistory.client.js";
import { fetchMetricProvenance } from "@/infrastructure/analysisApi/stock/metricProvenance.client.js";
import { fetchMetricsHistory } from "@/infrastructure/analysisApi/stock/metricsHistory.client.js";
import { fetchMonthlyRevenueHistory } from "@/infrastructure/analysisApi/stock/monthlyRevenueHistory.client.js";
import { fetchPiotroskiBreakdown } from "@/infrastructure/analysisApi/stock/piotroskiBreakdown.client.js";
import { fetchPreferredStocks } from "@/infrastructure/analysisApi/stock/preferredStocks.client.js";
import { fetchPreferredStockFieldCatalog } from "@/infrastructure/analysisApi/stock/preferredStocksFieldCatalog.client.js";
import { fetchRoaHistory, fetchRoeHistory } from "@/infrastructure/analysisApi/stock/roeRoaHistory.client.js";
import { fetchStockPrices, fetchStockQuote } from "@/infrastructure/analysisApi/stock/stockQuote.client.js";

/**
 * StockGatewayPort 的實作。跟其他切片不同，這個切片的 adapter 自己一個檔案而不是掛在某支 client 的檔尾：
 * 這裡有 20 支 client，沒有哪一支適合當「主檔」，硬選一支只會讓它看起來比鄰居重要。
 *
 * 內容仍然只是對應關係——每支 fetchX 都已經做完正規化、404/400/502 判定，這裡一行邏輯都沒有。中間原本還
 * 隔著一支 stock.service.ts，但除了 assertSymbolExists 以外每個函式都是 `getX(args) => fetchX(args)`
 * （參數驗證全在 route 的 zod schema，那份 schema 同時是 OpenAPI 的來源），所以那些空殼已經刪掉，route
 * 直接呼叫這個 port——跟 macro 切片同樣的判斷。
 *
 * 那支 client 各自的欄位正規化都是有意義的，不是樣板：它們會靜靜丟掉上游多出來的欄位，而且有幾個是踩過坑
 * 才寫成那樣（companyList 的 isEmerging 用 `=== true`，badges 的 thresholdValue 允許真正的 0）。要動它們
 * 之前先看那支檔案的註解。
 */
export const analysisStockGateway: StockGatewayPort = {
  getCompanyList: fetchCompanyList,
  getStockQuote: fetchStockQuote,
  getLatestClosePrices: fetchStockPrices,
  getCompanyProfile: fetchCompanyProfile,
  getBeta: fetchBeta,
  getCompanyBadges: fetchCompanyBadges,
  getCapitalStockHistory: fetchCapitalStockHistory,
  getDividendHistory: fetchDividendHistory,
  getExDividendNotices: fetchExDividendNotices,
  getExDividendCalendar: fetchExDividendCalendar,
  getFinancialStatement: fetchFinancialStatement,
  getPreferredStocks: fetchPreferredStocks,
  getPreferredStockFieldCatalog: fetchPreferredStockFieldCatalog,
  getMetricHistory: fetchMetricHistory,
  getMetricsHistory: fetchMetricsHistory,
  getRoeHistory: fetchRoeHistory,
  getRoaHistory: fetchRoaHistory,
  getDupontHistory: fetchDupontHistory,
  getBookValueBreakdown: fetchBookValueBreakdown,
  getValuationRiver: fetchValuationRiver,
  getMonthlyRevenueHistory: fetchMonthlyRevenueHistory,
  getForeignShareholdingHistory: fetchForeignShareholdingHistory,
  getDailyPriceHistory: fetchDailyPriceHistory,
  getPiotroskiBreakdown: fetchPiotroskiBreakdown,
  getMetricProvenance: fetchMetricProvenance,
};
