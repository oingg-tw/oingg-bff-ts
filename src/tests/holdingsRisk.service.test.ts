import { describe, expect, it, vi } from "vitest";
import { fakeTransactions } from "@/tests/fakes/transactions.js";
import { fakeMarketGateway, fakeStockGateway } from "@/tests/fakes/analysisGateways.js";
import type { StockTransaction } from "@/application/transactions/transactions.types.js";
import { getPortfolioRisk } from "@/application/holdings/holdingsRisk.service.js";

/** 編排：權重、沒有股價的持股、除權比例有沒有傳到計算。風險公式本身在 portfolioRisk.test.ts。 */
const TAIEX = ["2026-02-27", "2026-03-02", "2026-03-03", "2026-03-04"];

function row(symbol: string, quantity: number, tradeDate = "2026-01-02"): StockTransaction {
  return {
    id: `${symbol}-${tradeDate}`,
    symbol,
    action: "BUY",
    quantity,
    price: "10",
    fee: "0",
    tax: "0",
    tradeDate,
    note: null,
    source: null,
    externalRef: null,
    importId: null,
    costUnknown: false,
    createdAt: `${tradeDate}T00:00:00.000Z`,
    updatedAt: `${tradeDate}T00:00:00.000Z`,
  };
}

function deps(ledger: StockTransaction[], prices: Record<string, number[]>, calendarRows: { symbol: string; exDate: string; stockDividendRatio: number }[] = []) {
  return {
    transactions: fakeTransactions({ list: vi.fn().mockResolvedValue(ledger) }),
    marketGateway: fakeMarketGateway({
      getTaiexDailyPrice: vi.fn().mockResolvedValue({ entries: TAIEX.map((tradeDate, i) => ({ tradeDate, close: String(100 + i) })) }),
    }),
    stockGateway: fakeStockGateway({
      getDailyPriceHistory: vi.fn().mockImplementation(async (symbol: string) => ({
        symbol,
        entries: (prices[symbol] ?? []).map((close, i) => ({ tradeDate: TAIEX[i]!, open: null, high: null, low: null, close, volume: 1 })),
        earliestAvailableTradeDate: null,
      })),
      getExDividendCalendar: vi.fn().mockImplementation(async (month: string) => ({ entries: calendarRows.filter((r) => r.exDate.startsWith(month)) })),
    }),
  };
}

describe("getPortfolioRisk", () => {
  it("weights holdings by shares × latest close, largest first", async () => {
    // A：1000 股 × 最新 20 = 20,000；B：500 股 × 最新 60 = 30,000 → B 0.6、A 0.4
    const report = await getPortfolioRisk(
      "uid1",
      "2026-03-01",
      "2026-03-04",
      deps([row("A", 1000), row("B", 500)], { A: [10, 11, 12, 20], B: [50, 55, 58, 60] }),
    );

    expect(report.holdings).toEqual([
      { symbol: "B", weight: "0.600000", coverage: "full", firstPriceDate: null, riskContribution: null },
      { symbol: "A", weight: "0.400000", coverage: "full", firstPriceDate: null, riskContribution: null },
    ]);
    expect(report.weightsAsOf).toBe("2026-03-04");
    expect(report.tradingDays).toBe(3);
  });

  it("marks a holding with no prices at all as none, with no weight", async () => {
    const report = await getPortfolioRisk("uid1", "2026-03-01", "2026-03-04", deps([row("A", 1000), row("Z", 10)], { A: [10, 11, 12, 13] }));

    expect(report.holdings.find((h) => h.symbol === "Z")).toEqual({ symbol: "Z", weight: null, coverage: "none", firstPriceDate: null, riskContribution: null });
    expect(report.holdings.find((h) => h.symbol === "A")!.weight).toBe("1.000000");
  });

  // 除權比例要真的傳進計算：一檔只因配股而股價減半、其他沒變動 → 沒有回撤。
  it("passes ex-rights ratios through, so a stock dividend is not a drawdown", async () => {
    const report = await getPortfolioRisk(
      "uid1",
      "2026-03-01",
      "2026-03-04",
      deps([row("A", 1000)], { A: [20, 20, 10, 10] }, [{ symbol: "A", exDate: "2026-03-03", stockDividendRatio: 1 }]),
    );

    expect(report.portfolio.maxDrawdown.depth).toBe("0.000000");
  });

  it("returns an empty report when the user holds nothing", async () => {
    const report = await getPortfolioRisk("uid1", "2026-03-01", "2026-03-04", deps([], {}));

    expect(report).toMatchObject({ tradingDays: 0, weightsAsOf: null, holdings: [], portfolio: { annualizedVolatility: null } });
  });
});
