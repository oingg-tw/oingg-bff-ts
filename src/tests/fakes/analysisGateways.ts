import { vi } from "vitest";
import type { EtfScreenerGatewayPort } from "@/application/ports/etfScreenerGateway.js";
import type { MarketGatewayPort } from "@/application/ports/marketGateway.js";
import type { ScreenerGatewayPort } from "@/application/ports/screenerGateway.js";
import type { StockGatewayPort } from "@/application/ports/stockGateway.js";

/**
 * Typed fakes of the proxy slices' outbound gateways. They share a file because they are the same idea —
 * "everything this service asks oingg-analysis-ts for" — and because the alternative was one two-line
 * file per slice.
 *
 * Being typed as the port is the point (same reason as fakes/screenerPresets.ts): add a method to a
 * gateway and these stop compiling, instead of a `vi.mock` of the client module quietly passing against
 * a shape that no longer exists. The defaults throw nothing and return nothing useful — every test
 * overrides exactly the call it exercises, so an unexpected extra upstream call shows up as an
 * undefined result rather than a plausible-looking one.
 */
export function fakeMarketGateway(overrides: Partial<MarketGatewayPort> = {}): MarketGatewayPort {
  return {
    getMarginShortRatioRanking: vi.fn(),
    getMaterialAnnouncements: vi.fn(),
    getRevenueRanking: vi.fn(),
    getVolumeTop20: vi.fn(),
    getDisposedStocks: vi.fn(),
    getAttentionStocks: vi.fn(),
    getPriceLimitRange: vi.fn(),
    getPriceChangeRanking: vi.fn(),
    getEtfRanking: vi.fn(),
    getTaiexDailyPrice: vi.fn(),
    ...overrides,
  };
}

export function fakeEtfScreenerGateway(overrides: Partial<EtfScreenerGatewayPort> = {}): EtfScreenerGatewayPort {
  return {
    getFieldCatalog: vi.fn(),
    runScreener: vi.fn(),
    ...overrides,
  };
}

/**
 * The biggest of these by far — 23 methods, because analysis-ts's per-company API is that wide (see
 * StockGatewayPort). Listing them all out is the point: if that surface grows, this file is one of the
 * places that has to acknowledge it.
 */
export function fakeStockGateway(overrides: Partial<StockGatewayPort> = {}): StockGatewayPort {
  return {
    getCompanyList: vi.fn(),
    getStockQuote: vi.fn(),
    getLatestClosePrices: vi.fn(),
    getCompanyProfile: vi.fn(),
    getBeta: vi.fn(),
    getCompanyBadges: vi.fn(),
    getCapitalStockHistory: vi.fn(),
    getDividendHistory: vi.fn(),
    getExDividendNotices: vi.fn(),
    getExDividendCalendar: vi.fn(),
    getFinancialStatement: vi.fn(),
    getPreferredStocks: vi.fn(),
    getPreferredStockFieldCatalog: vi.fn(),
    getMetricHistory: vi.fn(),
    getMetricsHistory: vi.fn(),
    getRoeHistory: vi.fn(),
    getRoaHistory: vi.fn(),
    getDupontHistory: vi.fn(),
    getMonthlyRevenueHistory: vi.fn(),
    getForeignShareholdingHistory: vi.fn(),
    getDailyPriceHistory: vi.fn(),
    getPiotroskiBreakdown: vi.fn(),
    getMetricProvenance: vi.fn(),
    ...overrides,
  };
}

export function fakeScreenerGateway(overrides: Partial<ScreenerGatewayPort> = {}): ScreenerGatewayPort {
  return {
    runScreener: vi.fn(),
    runRanking: vi.fn(),
    getValues: vi.fn(),
    getCompanyRank: vi.fn(),
    getDistribution: vi.fn(),
    getValuationRanking: vi.fn(),
    ...overrides,
  };
}
