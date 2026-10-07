import { describe, expect, it, vi } from "vitest";
import { fakeTransactions } from "@/tests/fakes/transactions.js";
import { fakeMarketGateway, fakeStockGateway, fakeMacroGateway } from "@/tests/fakes/analysisGateways.js";
import type { StockTransaction } from "@/application/transactions/transactions.types.js";
import { getPortfolioPerformance } from "@/application/holdings/holdingsPerformance.service.js";

/**
 * 這裡驗的是**編排**：期間、起點、該抓哪幾檔的價格、深度上限。報酬率的算術本身在
 * portfolioReturn.test.ts，以不變量驗過。
 */
const TAIEX = ["2026-02-27", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"];

function row(symbol: string, action: "BUY" | "SELL", quantity: number, price: number, tradeDate: string): StockTransaction {
  return {
    id: `${symbol}-${tradeDate}-${action}`,
    symbol,
    action,
    quantity,
    price: String(price),
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

function deps(ledger: StockTransaction[], taiexDates = TAIEX) {
  const prices: Record<string, number[]> = { "2330": [100, 101, 102, 103, 104], "0056": [30, 30, 31, 31, 32], "2317": [200, 200, 200, 200, 200] };
  return {
    // 預設：無風險利率取不到（上游還沒有這支）。riskAdjusted 全 null，其他欄位照常。
    macroGateway: fakeMacroGateway({ getFiveMajorBankRate: vi.fn().mockRejectedValue(new Error("upstream down")) }),
    transactions: fakeTransactions({ list: vi.fn().mockResolvedValue(ledger) }),
    marketGateway: fakeMarketGateway({
      getTaiexDailyPrice: vi.fn().mockResolvedValue({ entries: taiexDates.map((tradeDate) => ({ tradeDate, close: "20000" })) }),
    }),
    stockGateway: fakeStockGateway({
      getDailyPriceHistory: vi.fn().mockImplementation(async (symbol: string) => ({
        symbol,
        entries: TAIEX.map((tradeDate, i) => ({ tradeDate, open: null, high: null, low: null, close: prices[symbol]?.[i] ?? null, volume: 1 })),
        earliestAvailableTradeDate: TAIEX[0],
      })),
    }),
  };
}

describe("getPortfolioPerformance", () => {
  it("starts from the last trading day before `from` and aligns the series to TAIEX dates", async () => {
    const report = await getPortfolioPerformance("uid1", "2026-03-01", "2026-03-05", deps([row("2330", "BUY", 10, 99, "2026-02-01")]));

    // 起點是 02-27（100），期末 104。
    expect(report.series.map((p) => p.date)).toEqual(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]);
    expect(report.twr).toBe("0.040000");
    expect(report.missingPrices).toEqual([]);
  });

  it("fetches prices only for symbols actually held during the window", async () => {
    const d = deps([
      row("2317", "BUY", 10, 200, "2026-01-05"),
      row("2317", "SELL", 10, 210, "2026-01-20"), // 起點前就出清
      row("0056", "BUY", 1000, 30, "2026-03-03"), // 期間內才買
      row("2330", "BUY", 10, 99, "2026-02-01"), // 起點時持有
    ]);

    await getPortfolioPerformance("uid1", "2026-03-01", "2026-03-05", d);

    const fetched = (d.stockGateway.getDailyPriceHistory as ReturnType<typeof vi.fn>).mock.calls.map(([s]) => s).sort();
    expect(fetched).toEqual(["0056", "2330"]);
  });

  it("returns a null twr and an empty series when the window has no trading day", async () => {
    const report = await getPortfolioPerformance("uid1", "2026-03-07", "2026-03-08", deps([row("2330", "BUY", 10, 99, "2026-02-01")]));

    expect(report).toMatchObject({ from: "2026-03-07", to: "2026-03-08", twr: null, mwr: null, series: [], missingPrices: [] });
  });

  /**
   * 個股收盤價最多回溯 2000 個交易日。期間比那還長時，較早的日子會沒有收盤價、只能用交易價估值——
   * 那會是一個看起來正常的錯數字，所以要明確拒絕，並說出最早能從哪天開始。
   */
  it("rejects a window deeper than the available price history, naming the earliest valid start", async () => {
    const longCalendar = Array.from({ length: 2100 }, (_, i) => new Date(Date.UTC(2018, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));

    await expect(
      getPortfolioPerformance("uid1", "2018-01-10", "2023-09-01", deps([row("2330", "BUY", 10, 99, "2017-01-01")], longCalendar)),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "RANGE_BEFORE_PRICE_HISTORY",
      // 前端讀這個欄位，不再拿正則拆訊息（2026-10-08）。
      extensions: { earliestPriceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    });
  });

  it("defaults to the year before `to`, mapping 2/29 to 2/28", async () => {
    const report = await getPortfolioPerformance("uid1", undefined, "2028-02-29", deps([]));

    expect(report.from).toBe("2027-02-28");
  });
});

describe("risk-free rate", () => {
  it("still returns everything else when the risk-free rate is unavailable", async () => {
    const report = await getPortfolioPerformance("uid1", "2026-03-01", "2026-03-05", deps([row("2330", "BUY", 10, 99, "2026-02-01")]));

    expect(report.twr).toBe("0.040000");
    expect(report.riskFree).toBeNull();
    expect(report.riskAdjusted.sharpe).toBeNull();
  });

  // CBC 月報落後一到兩個月：期間的月份還沒有資料時沿用最後一個有資料的月份，並照實列出來源月份。
  it("discloses the rate used per month, including months carried forward", async () => {
    const d = deps([row("2330", "BUY", 10, 99, "2026-02-01")]);
    d.macroGateway.getFiveMajorBankRate = vi.fn().mockResolvedValue({
      latestPeriod: "2026-01",
      entries: [{ period: "2026-01", year: 2026, month: 1, depositRate1mPct: 1.23, depositRate1yPct: 1.7, baseLendingRatePct: 3.264 }],
    });

    const report = await getPortfolioPerformance("uid1", "2026-03-01", "2026-03-05", d);

    expect(report.riskFree).toEqual({
      source: "five-major-bank-1y-deposit",
      latestPeriod: "2026-01",
      rates: [{ period: "2026-03", ratePct: 1.7, sourcePeriod: "2026-01" }],
    });
  });
});
