import { describe, expect, it, vi } from "vitest";
import { fakeTransactions } from "@/tests/fakes/transactions.js";
import { fakeStockGateway } from "@/tests/fakes/analysisGateways.js";
import {
  addTransaction,
  editTransaction,
  getTransactionOrThrow,
  getTransactions,
  removeTransaction,
} from "@/application/transactions/transactions.service.js";

/** 預設「沒有任何除權」——自動配股的行為在 stockDividends.test.ts 測。 */
const stockGateway = fakeStockGateway();

const SAMPLE_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const SAMPLE_TRANSACTION = {
  id: SAMPLE_ID,
  symbol: "2330",
  action: "BUY" as const,
  quantity: 1000,
  price: "550.5000",
  fee: "20.0000",
  tax: "0.0000",
  tradeDate: "2026-08-30",
  note: null,
  source: null,
  externalRef: null,
  importId: null,
  costUnknown: false,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

const VALID_INPUT = {
  symbol: "2330",
  action: "BUY" as const,
  quantity: 1000,
  price: 550.5,
  fee: 20,
  tax: 0,
  tradeDate: "2026-08-30",
  note: null,
};

describe("getTransactions", () => {
  it("passes the caller's uid and the optional symbol filter straight through to the port", async () => {
    const transactions = fakeTransactions({ list: vi.fn().mockResolvedValue([SAMPLE_TRANSACTION]) });

    await expect(getTransactions("uid1", "2330", { transactions, stockGateway })).resolves.toEqual([SAMPLE_TRANSACTION]);
    expect(transactions.list).toHaveBeenCalledWith("uid1", "2330");
  });

  it("leaves the symbol filter undefined when the caller didn't supply one", async () => {
    const transactions = fakeTransactions();

    await getTransactions("uid1", undefined, { transactions, stockGateway });

    expect(transactions.list).toHaveBeenCalledWith("uid1", undefined);
  });
});

describe("addTransaction", () => {
  it('rejects an action that is neither "BUY" nor "SELL"', async () => {
    const transactions = fakeTransactions();

    await expect(
      addTransaction("uid1", { ...VALID_INPUT, action: "HOLD" as never }, { transactions, stockGateway }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transactions.create).not.toHaveBeenCalled();
  });

  it("rejects a non-positive-integer quantity", async () => {
    const transactions = fakeTransactions();

    await expect(addTransaction("uid1", { ...VALID_INPUT, quantity: 0 }, { transactions, stockGateway })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(addTransaction("uid1", { ...VALID_INPUT, quantity: 1.5 }, { transactions, stockGateway })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  // 2026-10-05：price 0 從「不合法」變成「配股／分割」的表達方式，所以這裡驗的是**允許**。
  it("accepts a price of 0 (配股／分割 記成價格 0 的買進)", async () => {
    const transactions = fakeTransactions({ create: vi.fn().mockResolvedValue(SAMPLE_TRANSACTION) });

    await expect(addTransaction("uid1", { ...VALID_INPUT, price: 0 }, { transactions, stockGateway })).resolves.toEqual(
      SAMPLE_TRANSACTION,
    );
  });

  it("rejects a negative price", async () => {
    const transactions = fakeTransactions();

    await expect(addTransaction("uid1", { ...VALID_INPUT, price: -1 }, { transactions, stockGateway })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects a negative fee or tax (zero is allowed)", async () => {
    const transactions = fakeTransactions();

    await expect(addTransaction("uid1", { ...VALID_INPUT, fee: -1 }, { transactions, stockGateway })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(addTransaction("uid1", { ...VALID_INPUT, tax: -1 }, { transactions, stockGateway })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects a malformed tradeDate", async () => {
    const transactions = fakeTransactions();

    await expect(
      addTransaction("uid1", { ...VALID_INPUT, tradeDate: "2026/08/30" }, { transactions, stockGateway }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      addTransaction("uid1", { ...VALID_INPUT, tradeDate: "not-a-date" }, { transactions, stockGateway }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("creates the transaction once every field validates", async () => {
    const transactions = fakeTransactions({ create: vi.fn().mockResolvedValue(SAMPLE_TRANSACTION) });

    const result = await addTransaction("uid1", VALID_INPUT, { transactions, stockGateway });

    expect(result).toEqual(SAMPLE_TRANSACTION);
    expect(transactions.create).toHaveBeenCalledWith("uid1", VALID_INPUT);
  });
});

describe("getTransactionOrThrow", () => {
  // "missing" and "belongs to someone else" are deliberately the same answer — see the port's docs.
  it("throws a 404 when the transaction doesn't exist (or belongs to a different user)", async () => {
    const transactions = fakeTransactions();

    await expect(getTransactionOrThrow("uid1", "missing-uuid", { transactions, stockGateway })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns the transaction when found", async () => {
    const transactions = fakeTransactions({ find: vi.fn().mockResolvedValue(SAMPLE_TRANSACTION) });

    await expect(getTransactionOrThrow("uid1", SAMPLE_ID, { transactions, stockGateway })).resolves.toEqual(SAMPLE_TRANSACTION);
  });
});

describe("editTransaction", () => {
  it("rejects invalid fields before reaching the port", async () => {
    const transactions = fakeTransactions();

    await expect(editTransaction("uid1", SAMPLE_ID, { quantity: -1 }, { transactions, stockGateway })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(editTransaction("uid1", SAMPLE_ID, { tradeDate: "bad" }, { transactions, stockGateway })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(transactions.update).not.toHaveBeenCalled();
  });

  it("throws a 404 when the id doesn't exist (or isn't yours)", async () => {
    const transactions = fakeTransactions();

    await expect(editTransaction("uid1", SAMPLE_ID, { note: "x" }, { transactions, stockGateway })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(transactions.update).not.toHaveBeenCalled();
  });

  it("returns the updated transaction on success", async () => {
    const updated = { ...SAMPLE_TRANSACTION, quantity: 500 };
    const transactions = fakeTransactions({
      find: vi.fn().mockResolvedValue(SAMPLE_TRANSACTION),
      list: vi.fn().mockResolvedValue([SAMPLE_TRANSACTION]),
      update: vi.fn().mockResolvedValue(updated),
    });

    await expect(editTransaction("uid1", SAMPLE_ID, { quantity: 500 }, { transactions, stockGateway })).resolves.toEqual(updated);
    expect(transactions.update).toHaveBeenCalledWith("uid1", SAMPLE_ID, { quantity: 500 });
  });
});

describe("removeTransaction", () => {
  it("throws a 404 when the id doesn't exist (or isn't yours)", async () => {
    const transactions = fakeTransactions();

    await expect(removeTransaction("uid1", SAMPLE_ID, { transactions, stockGateway })).rejects.toMatchObject({ statusCode: 404 });
    expect(transactions.remove).not.toHaveBeenCalled();
  });

  it("resolves silently when the row was deleted", async () => {
    const transactions = fakeTransactions({
      find: vi.fn().mockResolvedValue(SAMPLE_TRANSACTION),
      list: vi.fn().mockResolvedValue([SAMPLE_TRANSACTION]),
      remove: vi.fn().mockResolvedValue(true),
    });

    await expect(removeTransaction("uid1", SAMPLE_ID, { transactions, stockGateway })).resolves.toBeUndefined();
  });
});

/**
 * 2026-10-05：持股變成交易的投影之後，寫入驗證的對象是**整段 replay**，不是單獨那一筆。
 * 這一組是那個差別的迴歸測試——只檢查當下那一筆的話，使用者可以用「先新增賣出、再刪掉買進」繞出負部位。
 */
describe("replay validation", () => {
  const BUY_100 = { ...SAMPLE_TRANSACTION, action: "BUY" as const, quantity: 100, price: "10", fee: "0", tax: "0" };
  const SELL_100 = {
    ...SAMPLE_TRANSACTION,
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    action: "SELL" as const,
    quantity: 100,
    price: "20",
    fee: "0",
    tax: "0",
    tradeDate: "2026-09-01",
    createdAt: "2026-09-01T00:00:00.000Z",
  };

  it("rejects a sell that exceeds the position at that point in time", async () => {
    const transactions = fakeTransactions({ list: vi.fn().mockResolvedValue([BUY_100]) });

    await expect(
      addTransaction(
        "uid1",
        { ...VALID_INPUT, action: "SELL", quantity: 300, fee: 0, tradeDate: "2026-09-01" },
        { transactions, stockGateway },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transactions.create).not.toHaveBeenCalled();
  });

  it("accepts a sell that exactly closes the position", async () => {
    const transactions = fakeTransactions({
      list: vi.fn().mockResolvedValue([BUY_100]),
      create: vi.fn().mockResolvedValue(SAMPLE_TRANSACTION),
    });

    await expect(
      addTransaction(
        "uid1",
        { ...VALID_INPUT, action: "SELL", quantity: 100, fee: 0, tradeDate: "2026-09-01" },
        { transactions, stockGateway },
      ),
    ).resolves.toEqual(SAMPLE_TRANSACTION);
  });

  it("rejects deleting a buy that a later sell depends on", async () => {
    const transactions = fakeTransactions({
      find: vi.fn().mockResolvedValue(BUY_100),
      list: vi.fn().mockResolvedValue([BUY_100, SELL_100]),
      remove: vi.fn().mockResolvedValue(true),
    });

    await expect(removeTransaction("uid1", BUY_100.id, { transactions, stockGateway })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactions.remove).not.toHaveBeenCalled();
  });

  it("rejects shrinking a past buy below what a later sell needs", async () => {
    const transactions = fakeTransactions({
      find: vi.fn().mockResolvedValue(BUY_100),
      list: vi.fn().mockResolvedValue([BUY_100, SELL_100]),
      update: vi.fn().mockResolvedValue(BUY_100),
    });

    await expect(editTransaction("uid1", BUY_100.id, { quantity: 50 }, { transactions, stockGateway })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(transactions.update).not.toHaveBeenCalled();
  });

  it("lets a past buy grow", async () => {
    const transactions = fakeTransactions({
      find: vi.fn().mockResolvedValue(BUY_100),
      list: vi.fn().mockResolvedValue([BUY_100, SELL_100]),
      update: vi.fn().mockResolvedValue(BUY_100),
    });

    await expect(editTransaction("uid1", BUY_100.id, { quantity: 200 }, { transactions, stockGateway })).resolves.toEqual(BUY_100);
  });
});
