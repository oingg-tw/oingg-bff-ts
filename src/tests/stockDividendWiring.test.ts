import { describe, expect, it, vi } from "vitest";
import { fakeTransactions } from "@/tests/fakes/transactions.js";
import { fakeSecuritiesGateway, fakeStockGateway } from "@/tests/fakes/analysisGateways.js";
import type { StockTransaction } from "@/application/transactions/transactions.types.js";
import { getHoldings, getRealizedProfitLoss } from "@/application/holdings/holdings.service.js";
import { addTransaction, editTransaction, getTransactions } from "@/application/transactions/transactions.service.js";
import { importTransactions } from "@/application/transactions/transactionImport.service.js";

/**
 * domain 算對還不夠：自動配股要在**每一條**持股重算的路徑上都套用，漏掉一條，那一條就會跟其他路徑
 * 算出不一樣的持股——例如 GET /holdings 顯示 12,628 股配股，賣的時候單筆寫入卻擋成賣超。這個檔案
 * 逐條驗接線；配股與成本不明本身的算術在 stockDividends.test.ts。
 *
 * 數字是使用者真實檔案的形狀（2026-10-05，web-nuxt 提供）：5314 持有 4,000 股、2026-08-14 除權
 * 每股配 3.157 股、之後賣出 12,628 股；5283 很久以前買的 4,000 股，券商紀錄已過期，成本不明。
 */
function row(symbol: string, action: "BUY" | "SELL", quantity: number, price: number, tradeDate: string, extra: Partial<StockTransaction> = {}): StockTransaction {
  return {
    id: `${symbol}-${tradeDate}-${action}-${quantity}`,
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
    createdAt: `${tradeDate}T01:00:00.000Z`,
    updatedAt: `${tradeDate}T01:00:00.000Z`,
    ...extra,
  };
}

const CALENDAR = {
  "2026-08": [{ symbol: "5314", exDate: "2026-08-14", stockDividendRatio: 3.157 }],
  "2026-07": [{ symbol: "7740", exDate: "2026-07-24", stockDividendRatio: 0.1278 }],
} as Record<string, { symbol: string; exDate: string; stockDividendRatio: number }[]>;

function deps(ledger: StockTransaction[]) {
  return {
    transactions: fakeTransactions({
      list: vi.fn().mockImplementation(async (_uid: string, symbol?: string) => (symbol ? ledger.filter((r) => r.symbol === symbol) : ledger)),
      find: vi.fn().mockImplementation(async (_uid: string, id: string) => ledger.find((r) => r.id === id) ?? null),
      create: vi.fn().mockImplementation(async () => ledger[0]),
      update: vi.fn().mockImplementation(async () => ledger[0]),
    }),
    stockGateway: fakeStockGateway({
      getExDividendCalendar: vi.fn().mockImplementation(async (month: string) => ({ entries: CALENDAR[month] ?? [] })),
    }),
    securitiesGateway: fakeSecuritiesGateway({
      getSecurityList: vi.fn().mockResolvedValue({ count: 3, entries: [{ symbol: "5314" }, { symbol: "5283" }, { symbol: "7740" }] }),
    }),
  };
}

const HOLD_5314 = [row("5314", "BUY", 4000, 60, "2026-06-01")];

describe("stock dividends reach every projection path", () => {
  it("GET /holdings shows the dividend shares", async () => {
    const holdings = await getHoldings("uid1", deps(HOLD_5314));

    expect(holdings).toEqual([expect.objectContaining({ symbol: "5314", quantity: 16_628, costUnknownQuantity: 0 })]);
  });

  // 最關鍵的一條：沒有接線的話，賣出配來的股票會被擋成 ledger_oversold。
  it("a single sale of the dividend shares is not rejected as oversold", async () => {
    const d = deps(HOLD_5314);

    await expect(
      addTransaction("uid1", { symbol: "5314", action: "SELL", quantity: 12_628, price: 15, fee: 0, tax: 0, tradeDate: "2026-09-17", note: null }, d),
    ).resolves.toBeDefined();
    expect(d.transactions.create).toHaveBeenCalled();
  });

  it("GET /transactions lists the dividend as a read-only synthetic row, below that day's real trades", async () => {
    const ledger = [...HOLD_5314, row("5314", "SELL", 100, 15, "2026-08-14")];

    const rows = await getTransactions("uid1", "5314", deps(ledger));

    expect(rows.map((r) => [r.tradeDate, r.action, r.quantity, r.source])).toEqual([
      ["2026-08-14", "SELL", 100, null],
      ["2026-08-14", "BUY", 12_628, "stock-dividend"],
      ["2026-06-01", "BUY", 4000, null],
    ]);
    expect(rows[1]!.id).toBe("stock-dividend:5314:2026-08-14");
  });

  it("import: 5314 has no shortfall once the dividend is applied", async () => {
    const outcome = await importTransactions(
      "uid1",
      {
        source: "yuanta-csv",
        dryRun: true,
        openingPositions: [],
        transactions: [
          { externalRef: "2026-09-17|A1", tradeDate: "2026-09-17", symbol: "5314", action: "SELL", quantity: 12_000, price: 15, fee: 0, tax: 0, costUnknown: false },
          { externalRef: "2026-09-17|A2", tradeDate: "2026-09-17", symbol: "5314", action: "SELL", quantity: 628, price: 15, fee: 0, tax: 0, costUnknown: false },
        ],
      },
      deps(HOLD_5314),
    );

    expect(outcome.ok).toBe(true);
  });
});

describe("cost-unknown acquisitions through the services", () => {
  const SELL_5283 = { externalRef: "2026-05-04|B1", tradeDate: "2026-05-04", symbol: "5283", action: "SELL" as const, quantity: 4000, price: 90, fee: 0, tax: 0, costUnknown: false };

  it("import: 5283's sale is fully short until a cost-unknown acquisition fills it", async () => {
    const short = await importTransactions("uid1", { source: "yuanta-csv", dryRun: true, openingPositions: [], transactions: [SELL_5283] }, deps([]));
    expect(short.ok === false && short.shortfalls).toEqual([{ symbol: "5283", tradeDate: "2026-05-04", externalRef: "2026-05-04|B1", shortBy: 4000 }]);

    const filled = await importTransactions(
      "uid1",
      {
        source: "yuanta-csv",
        dryRun: true,
        openingPositions: [],
        transactions: [
          SELL_5283,
          { externalRef: "2026-05-04|B1|cost-unknown", tradeDate: "2026-05-04", symbol: "5283", action: "BUY", quantity: 4000, price: 0, fee: 0, tax: 0, costUnknown: true },
        ],
      },
      deps([]),
    );
    expect(filled.ok).toBe(true);
  });

  it("realized P&L excludes the cost-unknown sale and says so", async () => {
    const ledger = [
      row("5283", "BUY", 4000, 0, "2026-05-04", { costUnknown: true }),
      row("5283", "SELL", 4000, 90, "2026-05-04", { createdAt: "2026-05-04T02:00:00.000Z" }),
    ];

    const report = await getRealizedProfitLoss("uid1", undefined, undefined, deps(ledger));

    // 「預設 0」會在這裡算出 +360,000 的假獲利（使用者說 5283 約 33.3 萬）。
    expect(report).toMatchObject({ totalRealizedProfitLoss: "0.0000", excludedSellCount: 1, excludedShares: 4000 });
  });

  it("rejects costUnknown on a SELL, and a cost-unknown row that carries a price", async () => {
    const d = deps([]);
    const base = { symbol: "5283", quantity: 10, fee: 0, tax: 0, tradeDate: "2026-05-04", note: null, costUnknown: true };

    await expect(addTransaction("uid1", { ...base, action: "SELL", price: 0 }, d)).rejects.toMatchObject({ statusCode: 400 });
    await expect(addTransaction("uid1", { ...base, action: "BUY", price: 88 }, d)).rejects.toMatchObject({ statusCode: 400 });
  });

  // 只送 { costUnknown: true } 給一筆 SELL，逐欄位檢查會全部通過——所以要驗合併之後的整列。
  it("rejects marking an existing SELL as cost-unknown", async () => {
    const sell = row("5283", "SELL", 10, 90, "2026-05-04");

    await expect(editTransaction("uid1", sell.id, { costUnknown: true }, deps([row("5283", "BUY", 10, 80, "2026-01-02"), sell]))).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
