import { describe, expect, it, vi } from "vitest";
import { fakeTransactions } from "@/tests/fakes/transactions.js";
import { fakeSecuritiesGateway, fakeStockGateway } from "@/tests/fakes/analysisGateways.js";
import type { ImportedTransaction, StockTransaction } from "@/application/transactions/transactions.types.js";
import {
  importTransactions,
  revertTransactionImport,
  type ImportedTransactionInput,
  type TransactionImportRequest,
} from "@/application/transactions/transactionImport.service.js";

/** 預設「沒有任何除權」——自動配股的行為在 stockDividends.test.ts 測。 */
const stockGateway = fakeStockGateway();

const LISTED = ["2330", "2317", "0056"];

function deps(overrides: { transactions?: Parameters<typeof fakeTransactions>[0]; listed?: string[] } = {}) {
  return {
    transactions: fakeTransactions(overrides.transactions),
    stockGateway: fakeStockGateway(),
    securitiesGateway: fakeSecuritiesGateway({
      getSecurityList: vi.fn().mockResolvedValue({
        count: (overrides.listed ?? LISTED).length,
        entries: (overrides.listed ?? LISTED).map((symbol) => ({ symbol })),
      }),
    }),
  };
}

function trade(overrides: Partial<ImportedTransactionInput> = {}): ImportedTransactionInput {
  return {
    externalRef: `2026-03-14|${overrides.action ?? "BUY"}${overrides.quantity ?? 1000}`,
    tradeDate: "2026-03-14",
    symbol: "2330",
    action: "BUY",
    quantity: 1000,
    price: 500,
    fee: 0,
    tax: 0,
    costUnknown: false,
    ...overrides,
  };
}

function request(overrides: Partial<TransactionImportRequest> = {}): TransactionImportRequest {
  return { source: "yuanta-csv", dryRun: true, openingPositions: [], transactions: [], ...overrides };
}

function storedRow(overrides: Partial<StockTransaction>): StockTransaction {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    symbol: "2330",
    action: "BUY",
    quantity: 1000,
    price: "500",
    fee: "0",
    tax: "0",
    tradeDate: "2026-01-02",
    note: null,
    source: null,
    externalRef: null,
    importId: null,
    costUnknown: false,
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function unwrap<T>(outcome: { ok: true; result: T } | { ok: false; shortfalls: unknown[] }): T {
  if (!outcome.ok) {
    throw new Error(`expected a successful import, got shortfalls: ${JSON.stringify(outcome.shortfalls)}`);
  }
  return outcome.result;
}

describe("importTransactions — 守門", () => {
  // "broker-csv" 是 2026-10-05 改名前的值，刻意不並存——它必須跟任何 typo 一樣被擋下。
  it("rejects a source outside the allowlist, including the retired broker-csv", async () => {
    for (const source of ["broker-csv", "yuantacsv"]) {
      await expect(importTransactions("uid1", request({ source }), deps())).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it("rejects a batch over the row cap", async () => {
    const transactions = Array.from({ length: 2001 }, (_, i) => trade({ externalRef: `ref-${i}` }));

    await expect(importTransactions("uid1", request({ transactions }), deps())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  /**
   * 批次內重複的 externalRef 要擋掉而不是靠 skipDuplicates 靜默吃掉——它正是 web-nuxt 量到的那個坑
   * （委託書號會跨日重用，所以 ref 要帶日期）。悄悄少寫一列比整批失敗難發現得多。
   */
  it("rejects a duplicate externalRef within the batch", async () => {
    const transactions = [trade({ externalRef: "same" }), trade({ externalRef: "same", quantity: 2000 })];

    await expect(importTransactions("uid1", request({ transactions }), deps())).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects unknown symbols with a 404, having queried the directory once", async () => {
    const d = deps();

    await expect(
      importTransactions("uid1", request({ transactions: [trade({ symbol: "NOPE9999" })] }), d),
    ).rejects.toMatchObject({ statusCode: 404 });
    // 整張總表拉一次，不是每個代號各跑一次。
    expect(d.securitiesGateway.getSecurityList).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed row before touching storage", async () => {
    const d = deps();

    await expect(
      importTransactions("uid1", request({ transactions: [trade({ price: -1 })] }), d),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(d.transactions.createManyImported).not.toHaveBeenCalled();
  });
});

describe("importTransactions — 排序與期初部位", () => {
  /**
   * 這是整個匯入唯一真正的決定的迴歸測試：**同日買進先於賣出**，不照陣列順序。
   * 陣列裡賣出排在買進之前（券商匯出檔真的會這樣），照列序 replay 會變成假的賣超。
   */
  it("orders a same-day sell after its buy, whatever the array order says", async () => {
    const d = deps({ transactions: { createManyImported: vi.fn().mockResolvedValue(2) } });

    const result = unwrap(
      await importTransactions(
        "uid1",
        request({
          dryRun: false,
          transactions: [
            trade({ externalRef: "s", action: "SELL", quantity: 1000, price: 600 }),
            trade({ externalRef: "b", action: "BUY", quantity: 1000, price: 500 }),
          ],
        }),
        d,
      ),
    );

    expect(result.holdings).toEqual([]); // 買 1000 再賣 1000 = 出清，沒有賣超
    const rows = (d.transactions.createManyImported as ReturnType<typeof vi.fn>).mock.calls[0]![2] as ImportedTransaction[];
    expect(rows.map((row) => row.externalRef)).toEqual(["b", "s"]);
    // createdAt 逐列指派，否則之後每次重算的同日排序都是未定義的。
    expect(rows[0]!.createdAt.getTime()).toBeLessThan(rows[1]!.createdAt.getTime());
  });

  it("dates an opening position the day before the symbol's earliest trade", async () => {
    const d = deps({ transactions: { createManyImported: vi.fn().mockResolvedValue(2) } });

    await importTransactions(
      "uid1",
      request({
        dryRun: false,
        openingPositions: [{ symbol: "2330", quantity: 500, averageCost: 400 }],
        transactions: [trade({ tradeDate: "2026-03-14" })],
      }),
      d,
    );

    const rows = (d.transactions.createManyImported as ReturnType<typeof vi.fn>).mock.calls[0]![2] as ImportedTransaction[];
    const opening = rows.find((row) => row.source === "opening")!;
    expect(opening.tradeDate).toBe("2026-03-13");
    expect(opening.externalRef).toBe("2330");
  });

  // 既有交易比這一批更早時，期初必須排在**那些**交易之前，否則它們全部變成賣超。
  it("looks at the stored ledger too when dating an opening position", async () => {
    const d = deps({
      transactions: {
        list: vi.fn().mockResolvedValue([storedRow({ tradeDate: "2025-06-01" })]),
        createManyImported: vi.fn().mockResolvedValue(1),
      },
    });

    await importTransactions(
      "uid1",
      request({ dryRun: false, openingPositions: [{ symbol: "2330", quantity: 500, averageCost: 400 }] }),
      d,
    );

    const rows = (d.transactions.createManyImported as ReturnType<typeof vi.fn>).mock.calls[0]![2] as ImportedTransaction[];
    expect(rows[0]!.tradeDate).toBe("2025-05-31");
  });

  it("skips an opening position the symbol already has, without overwriting it", async () => {
    const d = deps({
      transactions: {
        existingExternalRefs: vi.fn().mockResolvedValue(["2330"]),
        list: vi.fn().mockResolvedValue([storedRow({ source: "opening", externalRef: "2330" })]),
        createManyImported: vi.fn().mockResolvedValue(0),
      },
    });

    const result = unwrap(
      await importTransactions(
        "uid1",
        request({ dryRun: false, openingPositions: [{ symbol: "2330", quantity: 999, averageCost: 1 }] }),
        d,
      ),
    );

    expect(result.openingPositions).toEqual([{ symbol: "2330", status: "skipped" }]);
    // 沒有任何新列，所以連寫入都不發生（也就不發 importId）。
    expect(d.transactions.createManyImported).not.toHaveBeenCalled();
    expect(result.importId).toBeNull();
    // 沿用原值：既有那一筆是 1000@500，不是請求裡的 999@1。
    expect(result.holdings).toEqual([
      { symbol: "2330", quantity: 1000, costUnknownQuantity: 0, averageCost: "500.0000", totalCost: "500000.0000", realizedProfitLoss: "0.0000" },
    ]);
  });
});

describe("importTransactions — 冪等與 dryRun", () => {
  it("counts already-imported rows as duplicates instead of failing", async () => {
    const d = deps({ transactions: { existingExternalRefs: vi.fn().mockResolvedValue(["dup"]) } });

    const result = unwrap(
      await importTransactions(
        "uid1",
        request({ transactions: [trade({ externalRef: "dup" }), trade({ externalRef: "fresh", quantity: 2000 })] }),
        d,
      ),
    );

    expect({ inserted: result.inserted, duplicates: result.duplicates }).toEqual({ inserted: 1, duplicates: 1 });
  });

  // 2026-10-05 實測抓到的：重匯同一份檔回了一個新的 importId，但它底下 0 筆，拿去撤銷只會 404。
  it("issues no importId when every row is a duplicate", async () => {
    const d = deps({ transactions: { existingExternalRefs: vi.fn().mockResolvedValue(["dup"]) } });

    const result = unwrap(
      await importTransactions("uid1", request({ dryRun: false, transactions: [trade({ externalRef: "dup" })] }), d),
    );

    expect(result.importId).toBeNull();
    expect(d.transactions.createManyImported).not.toHaveBeenCalled();
  });

  it("writes nothing and returns a null importId on dryRun", async () => {
    const d = deps();

    const result = unwrap(await importTransactions("uid1", request({ transactions: [trade()] }), d));

    expect(result.importId).toBeNull();
    expect(result.inserted).toBe(1);
    expect(d.transactions.createManyImported).not.toHaveBeenCalled();
    // 預覽的持股與 GET /holdings 同一支投影算的，所以前端不需要自己 replay。
    expect(result.holdings).toEqual([
      { symbol: "2330", quantity: 1000, costUnknownQuantity: 0, averageCost: "500.0000", totalCost: "500000.0000", realizedProfitLoss: "0.0000" },
    ]);
  });

  it("returns every shortfall and writes nothing when the batch oversells", async () => {
    const d = deps();

    const outcome = await importTransactions(
      "uid1",
      request({
        dryRun: false,
        transactions: [
          trade({ externalRef: "sell-2330", action: "SELL", quantity: 1000, price: 600 }),
          trade({ externalRef: "sell-2317", symbol: "2317", action: "SELL", quantity: 500, price: 100 }),
        ],
      }),
      d,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.shortfalls).toEqual([
      { symbol: "2330", tradeDate: "2026-03-14", externalRef: "sell-2330", shortBy: 1000 },
      { symbol: "2317", tradeDate: "2026-03-14", externalRef: "sell-2317", shortBy: 500 },
    ]);
    expect(d.transactions.createManyImported).not.toHaveBeenCalled();
  });
});

describe("revertTransactionImport", () => {
  it("throws a 404 for an unknown importId", async () => {
    await expect(revertTransactionImport("uid1", "import-1", { transactions: fakeTransactions(), stockGateway })).rejects.toMatchObject(
      { statusCode: 404 },
    );
  });

  it("deletes the batch when the remaining ledger stays valid", async () => {
    const batch = [storedRow({ id: "row-1", importId: "import-1" })];
    const transactions = fakeTransactions({
      listByImportId: vi.fn().mockResolvedValue(batch),
      list: vi.fn().mockResolvedValue(batch),
      removeByImportId: vi.fn().mockResolvedValue(1),
    });

    await expect(revertTransactionImport("uid1", "import-1", { transactions, stockGateway })).resolves.toEqual({ ok: true, deleted: 1 });
    expect(transactions.removeByImportId).toHaveBeenCalledWith("uid1", "import-1");
  });

  // 撤銷整批可能讓之後手動輸入的賣出變成賣超。那時候什麼都不刪，而不是留下負部位。
  it("refuses to revert when a later manual sell depends on the batch", async () => {
    const buy = storedRow({ id: "row-1", importId: "import-1" });
    const manualSell = storedRow({ id: "row-2", action: "SELL", quantity: 1000, tradeDate: "2026-06-01" });
    const transactions = fakeTransactions({
      listByImportId: vi.fn().mockResolvedValue([buy]),
      list: vi.fn().mockResolvedValue([buy, manualSell]),
      removeByImportId: vi.fn().mockResolvedValue(1),
    });

    const outcome = await revertTransactionImport("uid1", "import-1", { transactions, stockGateway });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.shortfalls[0]).toMatchObject({ symbol: "2330", shortBy: 1000 });
    expect(transactions.removeByImportId).not.toHaveBeenCalled();
  });
});
