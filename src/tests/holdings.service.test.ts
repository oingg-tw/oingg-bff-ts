import { describe, expect, it, vi } from "vitest";
import { fakeTransactions } from "@/tests/fakes/transactions.js";
import { fakeStockGateway } from "@/tests/fakes/analysisGateways.js";
import type { StockTransaction } from "@/application/transactions/transactions.types.js";
import { getHoldings, getRealizedProfitLoss, removeHoldingSymbol } from "@/application/holdings/holdings.service.js";

/** 預設「沒有任何除權」——自動配股的行為在 stockDividends.test.ts 測。 */
const stockGateway = fakeStockGateway();

/**
 * 持股 2026-10-05 起沒有自己的 port——它讀的是 TransactionsPort。所以這個檔案驗的是**服務層的決定**
 * （哪些部位進清單、怎麼排、字串精度、刪除的語意），fold 本身的算術在 holdingProjection.test.ts。
 */
function row(overrides: Partial<StockTransaction> & Pick<StockTransaction, "symbol" | "action" | "quantity" | "price">): StockTransaction {
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(overrides.quantity).padStart(12, "0")}`,
    fee: "0",
    tax: "0",
    tradeDate: "2026-01-01",
    note: null,
    source: null,
    externalRef: null,
    importId: null,
    costUnknown: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getHoldings", () => {
  it("projects the whole ledger with 4-decimal strings", async () => {
    const transactions = fakeTransactions({
      list: vi.fn().mockResolvedValue([
        row({ symbol: "2330", action: "BUY", quantity: 1000, price: "100", fee: "20" }),
        row({ symbol: "2330", action: "BUY", quantity: 1000, price: "120", fee: "20", createdAt: "2026-01-01T01:00:00.000Z" }),
      ]),
    });

    await expect(getHoldings("uid1", { transactions, stockGateway })).resolves.toEqual([
      { symbol: "2330", quantity: 2000, costUnknownQuantity: 0, averageCost: "110.0200", totalCost: "220040.0000", realizedProfitLoss: "0.0000" },
    ]);
    // 全部代號一次算完，所以不帶 symbol 篩選。
    expect(transactions.list).toHaveBeenCalledWith("uid1");
  });

  // 已出清就不是持股。這一條同時是「已實現損益會跟著消失」那個已知缺口的紀錄。
  it("drops symbols whose position is closed, and sorts the rest by symbol", async () => {
    const transactions = fakeTransactions({
      list: vi.fn().mockResolvedValue([
        row({ symbol: "2330", action: "BUY", quantity: 100, price: "1000" }),
        row({ symbol: "0056", action: "BUY", quantity: 2000, price: "40" }),
        row({ symbol: "0056", action: "SELL", quantity: 2000, price: "45", tradeDate: "2026-03-01" }),
        row({ symbol: "1312A", action: "BUY", quantity: 500, price: "20" }),
      ]),
    });

    const holdings = await getHoldings("uid1", { transactions, stockGateway });

    expect(holdings.map((h) => h.symbol)).toEqual(["1312A", "2330"]);
  });

  // 併發寫入理論上能讓兩筆賣出各自通過檢查。那時候「看自己的持股」不能整個失敗。
  it("still answers when the stored ledger is itself oversold", async () => {
    const transactions = fakeTransactions({
      list: vi.fn().mockResolvedValue([
        row({ symbol: "2330", action: "BUY", quantity: 100, price: "10" }),
        row({ symbol: "2330", action: "SELL", quantity: 300, price: "20", tradeDate: "2026-02-01" }),
      ]),
    });

    await expect(getHoldings("uid1", { transactions, stockGateway })).resolves.toEqual([]);
  });

  it("returns an empty list for a user with no transactions", async () => {
    await expect(getHoldings("uid1", { transactions: fakeTransactions(), stockGateway })).resolves.toEqual([]);
  });
});

describe("removeHoldingSymbol", () => {
  it("throws a 404 when the user has no transactions for that symbol", async () => {
    const transactions = fakeTransactions();

    await expect(removeHoldingSymbol("uid1", "2330", { transactions, stockGateway })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("deletes every transaction for the symbol, scoped to the caller", async () => {
    const transactions = fakeTransactions({ removeBySymbol: vi.fn().mockResolvedValue(3) });

    await expect(removeHoldingSymbol("uid1", "2330", { transactions, stockGateway })).resolves.toBeUndefined();
    expect(transactions.removeBySymbol).toHaveBeenCalledWith("uid1", "2330");
  });
});

describe("getRealizedProfitLoss", () => {
  // 2330：1 月買 1000@100，3 月買 1000@200（均價 150），5 月賣 500@300，9 月賣 1500@100（出清）。
  // 0056：2 月買 2000@30，6 月全賣 @35（出清）。
  const ledger = [
    row({ symbol: "2330", action: "BUY", quantity: 1000, price: "100", tradeDate: "2026-01-10" }),
    row({ symbol: "0056", action: "BUY", quantity: 2000, price: "30", tradeDate: "2026-02-10" }),
    row({ symbol: "2330", action: "BUY", quantity: 1000, price: "200", tradeDate: "2026-03-10" }),
    row({ symbol: "2330", action: "SELL", quantity: 500, price: "300", tradeDate: "2026-05-10" }),
    row({ symbol: "0056", action: "SELL", quantity: 2000, price: "35", tradeDate: "2026-06-10" }),
    row({ symbol: "2330", action: "SELL", quantity: 1500, price: "100", tradeDate: "2026-09-10" }),
  ];
  const deps = () => ({ transactions: fakeTransactions({ list: vi.fn().mockResolvedValue(ledger) }), stockGateway });

  it("includes closed positions over the whole period", async () => {
    const report = await getRealizedProfitLoss("uid1", undefined, undefined, deps());

    // 2330：(300−150)×500 + (100−150)×1500 = 75,000 − 75,000 = 0；0056：(35−30)×2000 = 10,000
    expect(report).toEqual({
      from: null,
      to: null,
      symbols: [
        { symbol: "0056", realizedProfitLoss: "10000.0000", excludedSellCount: 0, excludedShares: 0 },
        { symbol: "2330", realizedProfitLoss: "0.0000", excludedSellCount: 0, excludedShares: 0 },
      ],
      totalRealizedProfitLoss: "10000.0000", excludedSellCount: 0, excludedShares: 0
    });
  });

  /**
   * 這一條守的是最容易做錯的地方：區間從 4 月開始，但 5 月那筆賣出的成本基礎必須是 1、3 月兩筆買進
   * 的均價 150。如果拿區間去截斷重算的輸入，區間內就沒有任何買進，成本會變成 0，已實現損益灌成
   * 150,000 而不是 75,000。
   */
  it("filters by sell date but keeps the cost basis from buys before the window", async () => {
    const report = await getRealizedProfitLoss("uid1", "2026-04-01", "2026-05-31", deps());

    expect(report.symbols).toEqual([{ symbol: "2330", realizedProfitLoss: "75000.0000", excludedSellCount: 0, excludedShares: 0 }]);
    expect(report.totalRealizedProfitLoss).toBe("75000.0000");
  });

  it("treats both ends of the window as inclusive", async () => {
    const report = await getRealizedProfitLoss("uid1", "2026-06-10", "2026-09-10", deps());

    expect(report.symbols.map((s) => s.symbol)).toEqual(["0056", "2330"]);
  });

  it("returns an empty report for a window with no sells", async () => {
    const report = await getRealizedProfitLoss("uid1", "2026-01-01", "2026-04-30", deps());

    expect(report).toEqual({ from: "2026-01-01", to: "2026-04-30", symbols: [], totalRealizedProfitLoss: "0.0000", excludedSellCount: 0, excludedShares: 0 });
  });
});
