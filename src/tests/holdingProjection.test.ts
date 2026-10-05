import { describe, expect, it } from "vitest";
import { projectHoldings, type LedgerEntry } from "@/domain/holdingProjection.js";

/**
 * 這個檔案守的是整個持股功能唯一的非平凡邏輯：那個 fold。持股不再是一張表之後，**算錯跟存錯是同一件事**
 * ——沒有別的地方可以對照出來。
 */
function entry(overrides: Partial<LedgerEntry> & Pick<LedgerEntry, "action" | "quantity" | "price">): LedgerEntry {
  return {
    symbol: "2330",
    fee: 0,
    tax: 0,
    tradeDate: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function only(entries: LedgerEntry[]) {
  const { holdings, oversold } = projectHoldings(entries);
  expect(oversold).toBeNull();
  expect(holdings).toHaveLength(1);
  return holdings[0]!;
}

describe("projectHoldings", () => {
  it("rolls a buy fee into the cost basis", () => {
    const position = only([entry({ action: "BUY", quantity: 1000, price: 100, fee: 20 })]);

    expect(position.quantity).toBe(1000);
    expect(position.totalCost).toBe(100_020);
    expect(position.averageCost).toBeCloseTo(100.02, 10);
  });

  it("averages two buys and leaves the average untouched by a sell", () => {
    const entries = [
      entry({ action: "BUY", quantity: 1000, price: 100, fee: 20, createdAt: "2026-01-01T01:00:00.000Z" }),
      entry({ action: "BUY", quantity: 1000, price: 120, fee: 20, createdAt: "2026-01-01T02:00:00.000Z" }),
    ];
    expect(only(entries).averageCost).toBeCloseTo(110.02, 10);

    // 賣出的手續費與交易稅只進已實現損益，不動剩餘均價——這是移動平均法與「把賣出成本攤回去」的分野。
    const afterSell = only([
      ...entries,
      entry({ action: "SELL", quantity: 500, price: 130, fee: 10, tax: 195, createdAt: "2026-01-01T03:00:00.000Z" }),
    ]);

    expect(afterSell.quantity).toBe(1500);
    expect(afterSell.averageCost).toBeCloseTo(110.02, 10);
    // 500 × 130 − 10 − 195 − 500 × 110.02
    expect(afterSell.realizedProfitLoss).toBeCloseTo(9785, 8);
  });

  /**
   * 這是 web-nuxt 2026-10-05 同意補的那個排序鍵的迴歸測試。`tradeDate` 只有日精度，所以同一天的
   * 「先買後賣」與「先賣後買」必須靠 createdAt 區分——少了它，同一組交易會算出兩個答案。
   */
  it("depends on createdAt to order same-day trades", () => {
    const opening = entry({ action: "BUY", quantity: 100, price: 10, createdAt: "2026-01-01T00:00:00.000Z" });
    const buy = entry({ action: "BUY", quantity: 100, price: 20, tradeDate: "2026-01-02" });
    const sell = entry({ action: "SELL", quantity: 50, price: 30, tradeDate: "2026-01-02" });

    // 兩組的**陣列順序都跟 createdAt 相反**。少了那個 tiebreaker 的話 Array.sort 是穩定排序，會原封不動
    // 保留陣列順序——也就是說「照陣列順序擺」的測法兩邊都會通過，根本驗不到比較函式。
    const buyFirst = only([
      { ...sell, createdAt: "2026-01-02T02:00:00.000Z" },
      { ...buy, createdAt: "2026-01-02T01:00:00.000Z" },
      opening,
    ]);
    const sellFirst = only([
      { ...buy, createdAt: "2026-01-02T02:00:00.000Z" },
      { ...sell, createdAt: "2026-01-02T01:00:00.000Z" },
      opening,
    ]);

    expect(buyFirst.quantity).toBe(150);
    expect(sellFirst.quantity).toBe(150);
    expect(buyFirst.averageCost).toBeCloseTo(15, 10);
    expect(sellFirst.averageCost).toBeCloseTo(16.666_666_666_666_668, 9);
  });

  it("reports the first oversell without blowing up the rest of the projection", () => {
    const { holdings, oversold } = projectHoldings([
      entry({ action: "BUY", quantity: 100, price: 10 }),
      entry({ action: "SELL", quantity: 300, price: 20, tradeDate: "2026-02-01" }),
    ]);

    expect(oversold).toEqual({ symbol: "2330", tradeDate: "2026-02-01", held: 100, attempted: 300 });
    // 夾成「把手上的全部賣掉」繼續算，而不是丟錯——GET /holdings 必須照樣回得出東西。
    expect(holdings[0]!.quantity).toBe(0);
  });

  it("zeroes the cost basis exactly on a full exit (no float residue)", () => {
    const position = only([
      entry({ action: "BUY", quantity: 3, price: 10, fee: 1 }),
      entry({ action: "SELL", quantity: 3, price: 12, tradeDate: "2026-02-01" }),
    ]);

    expect(position.quantity).toBe(0);
    expect(position.totalCost).toBe(0);
    expect(position.averageCost).toBe(0);
    expect(position.realizedProfitLoss).toBeCloseTo(5, 10); // 36 − 31
  });

  // 配股／分割記成價格 0 的買進（web-nuxt 的提案）：股數增加、成本不變，所以均價被稀釋。
  it("treats a price-0 buy as 配股 — more shares, same cost", () => {
    const position = only([
      entry({ action: "BUY", quantity: 1000, price: 50 }),
      entry({ action: "BUY", quantity: 100, price: 0, tradeDate: "2026-07-01" }),
    ]);

    expect(position.quantity).toBe(1100);
    expect(position.totalCost).toBe(50_000);
    expect(position.averageCost).toBeCloseTo(45.454_545_454_545_45, 10);
  });

  it("keeps each symbol's position independent", () => {
    const { holdings } = projectHoldings([
      entry({ symbol: "2330", action: "BUY", quantity: 100, price: 1000 }),
      entry({ symbol: "0056", action: "BUY", quantity: 2000, price: 40 }),
      entry({ symbol: "0056", action: "SELL", quantity: 2000, price: 45, tradeDate: "2026-03-01" }),
    ]);

    expect(holdings.find((h) => h.symbol === "2330")!.quantity).toBe(100);
    expect(holdings.find((h) => h.symbol === "0056")!.quantity).toBe(0);
  });

  it("does not mutate the caller's array", () => {
    const entries = [
      entry({ action: "BUY", quantity: 1, price: 1, tradeDate: "2026-05-01" }),
      entry({ action: "BUY", quantity: 1, price: 1, tradeDate: "2026-01-01" }),
    ];

    projectHoldings(entries);

    expect(entries.map((e) => e.tradeDate)).toEqual(["2026-05-01", "2026-01-01"]);
  });
});
