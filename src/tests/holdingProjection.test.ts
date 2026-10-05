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
  expect(oversold).toEqual([]);
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

  /**
   * 先進先出（2026-10-05 由移動平均改過來，使用者決定「比照券商」）：賣出從最舊的一批開始扣。
   * 移動平均法下這筆賣出的成本是 500 × 110.02，FIFO 下是第一批的 500 × 100.02。
   */
  it("consumes the oldest lot first", () => {
    const entries = [
      entry({ action: "BUY", quantity: 1000, price: 100, fee: 20, createdAt: "2026-01-01T01:00:00.000Z" }),
      entry({ action: "BUY", quantity: 1000, price: 120, fee: 20, createdAt: "2026-01-01T02:00:00.000Z" }),
    ];
    expect(only(entries).averageCost).toBeCloseTo(110.02, 10);

    const afterSell = only([
      ...entries,
      entry({ action: "SELL", quantity: 500, price: 130, fee: 10, tax: 195, createdAt: "2026-01-01T03:00:00.000Z" }),
    ]);

    expect(afterSell.quantity).toBe(1500);
    // 500 × 130 − 10 − 195 − 500 × 100.02（第一批）
    expect(afterSell.realizedProfitLoss).toBeCloseTo(14_785, 8);
    // 剩下：第一批 500 股（50,010）＋ 第二批 1000 股（120,020）
    expect(afterSell.totalCost).toBeCloseTo(170_030, 8);
    expect(afterSell.averageCost).toBeCloseTo(170_030 / 1500, 10);
  });

  /**
   * 這是 web-nuxt 2026-10-05 同意補的那個排序鍵的迴歸測試。`tradeDate` 只有日精度，所以同一天的先後
   * 必須靠 createdAt 區分。FIFO 下同日的順序不再影響已有批次的成本，但**仍然決定同一天的賣出有沒有股票
   * 可賣**——匯入的「同日先買後賣」規則就是靠這一點才不會製造假的賣超。
   */
  it("depends on createdAt to order same-day trades", () => {
    const buy = entry({ action: "BUY", quantity: 100, price: 20, tradeDate: "2026-01-02" });
    const sell = entry({ action: "SELL", quantity: 50, price: 30, tradeDate: "2026-01-02" });

    // 兩組的**陣列順序都跟 createdAt 相反**。少了那個 tiebreaker 的話 Array.sort 是穩定排序，會原封不動
    // 保留陣列順序——也就是說「照陣列順序擺」的測法兩邊都會通過，根本驗不到比較函式。
    const buyFirst = projectHoldings([
      { ...sell, createdAt: "2026-01-02T02:00:00.000Z" },
      { ...buy, createdAt: "2026-01-02T01:00:00.000Z" },
    ]);
    const sellFirst = projectHoldings([
      { ...buy, createdAt: "2026-01-02T02:00:00.000Z" },
      { ...sell, createdAt: "2026-01-02T01:00:00.000Z" },
    ]);

    expect(buyFirst.oversold).toEqual([]);
    expect(buyFirst.holdings[0]!.quantity).toBe(50);
    expect(sellFirst.oversold).toHaveLength(1);
  });

  it("reports the oversell without blowing up the rest of the projection", () => {
    const { holdings, oversold } = projectHoldings([
      entry({ action: "BUY", quantity: 100, price: 10 }),
      entry({ action: "SELL", quantity: 300, price: 20, tradeDate: "2026-02-01", ref: "2026-02-01|A1" }),
    ]);

    expect(oversold).toEqual([
      { symbol: "2330", tradeDate: "2026-02-01", held: 100, attempted: 300, shortBy: 200, ref: "2026-02-01|A1" },
    ]);
    // 夾成「把手上的全部賣掉」繼續算，而不是丟錯——GET /holdings 必須照樣回得出東西。
    expect(holdings[0]!.quantity).toBe(0);
  });

  /**
   * 批次匯入要一次把所有缺的期初部位請使用者補完，所以**每一筆**賣超都要列出來。第二筆的 shortBy
   * 是在第一筆被夾成 0 之後量的，所以它是**額外的**缺口——要補的期初股數是加總（200 + 50 = 250）。
   *
   * 2026-10-05 前這裡寫的是「取最大值」，錯的，而且照著它給過 web-nuxt 指引。下一條測試把
   * 「加總就是最小期初股數」寫成斷言，免得同樣的誤解只活在註解裡。
   */
  it("reports every oversell, each measured against the clamped position", () => {
    const { oversold } = projectHoldings([
      entry({ action: "BUY", quantity: 100, price: 10 }),
      entry({ action: "SELL", quantity: 300, price: 20, tradeDate: "2026-02-01" }),
      entry({ action: "SELL", quantity: 50, price: 20, tradeDate: "2026-03-01" }),
    ]);

    expect(oversold.map((o) => [o.tradeDate, o.shortBy])).toEqual([
      ["2026-02-01", 200],
      ["2026-03-01", 50],
    ]);
    expect(oversold.every((o) => o.ref === undefined)).toBe(true);
  });

  it("needs exactly the sum of shortBy as an opening position — not one share less", () => {
    const trades = [
      entry({ action: "BUY", quantity: 100, price: 10, tradeDate: "2026-01-02" }),
      entry({ action: "SELL", quantity: 300, price: 20, tradeDate: "2026-02-01" }),
      entry({ action: "BUY", quantity: 40, price: 10, tradeDate: "2026-02-15" }),
      entry({ action: "SELL", quantity: 90, price: 20, tradeDate: "2026-03-01" }),
    ];
    const total = projectHoldings(trades).oversold.reduce((sum, o) => sum + o.shortBy, 0);
    const withOpening = (quantity: number) =>
      projectHoldings([entry({ action: "BUY", quantity, price: 10, tradeDate: "2026-01-01" }), ...trades]).oversold;

    expect(total).toBe(250); // 200 + 50，取最大值會是 200
    expect(withOpening(total)).toEqual([]);
    expect(withOpening(total - 1)).not.toEqual([]);
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
