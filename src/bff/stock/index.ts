export { stockRouter } from "@/bff/stock/stock.routes.js";
export {
  assertSymbolExists,
  getCapitalStockHistory,
  getCompanyProfile,
  getExDividendNotices,
  getLatestClosePrices,
  getStockQuote,
} from "@/bff/stock/stock.service.js";
export type { ClosePrice } from "@/bff/stock/stock.service.js";
export type { StockPrice, StockQuote, StockValuation } from "@/bff/stock/stock.types.js";
export type { CompanyProfile, CompanyProfileMarket } from "@/bff/stock/companyProfile.types.js";
export type {
  CapitalStockChangeSource,
  CapitalStockHistoryEntry,
  CapitalStockHistoryResult,
} from "@/bff/stock/capitalStockHistory.types.js";
export type { ExDividendNoticeEntry, ExDividendType } from "@/bff/stock/exDividendNotices.types.js";
