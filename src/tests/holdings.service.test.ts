import { describe, expect, it, vi } from "vitest";
import { fakeTransactions } from "@/tests/fakes/transactions.js";
import type { StockTransaction } from "@/application/transactions/transactions.types.js";
import { getHoldings, removeHoldingSymbol } from "@/application/holdings/holdings.service.js";

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

    await expect(getHoldings("uid1", { transactions })).resolves.toEqual([
      { symbol: "2330", quantity: 2000, averageCost: "110.0200", totalCost: "220040.0000", realizedProfitLoss: "0.0000" },
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

    const holdings = await getHoldings("uid1", { transactions });

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

    await expect(getHoldings("uid1", { transactions })).resolves.toEqual([]);
  });

  it("returns an empty list for a user with no transactions", async () => {
    await expect(getHoldings("uid1", { transactions: fakeTransactions() })).resolves.toEqual([]);
  });
});

describe("removeHoldingSymbol", () => {
  it("throws a 404 when the user has no transactions for that symbol", async () => {
    const transactions = fakeTransactions();

    await expect(removeHoldingSymbol("uid1", "2330", { transactions })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("deletes every transaction for the symbol, scoped to the caller", async () => {
    const transactions = fakeTransactions({ removeBySymbol: vi.fn().mockResolvedValue(3) });

    await expect(removeHoldingSymbol("uid1", "2330", { transactions })).resolves.toBeUndefined();
    expect(transactions.removeBySymbol).toHaveBeenCalledWith("uid1", "2330");
  });
});
