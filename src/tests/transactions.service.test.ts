import { describe, expect, it, vi } from "vitest";
import type { TransactionsPort } from "@/application/ports/transactions.js";
import {
  addTransaction,
  editTransaction,
  getTransactionOrThrow,
  getTransactions,
  removeTransaction,
} from "@/application/transactions/transactions.service.js";

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

/**
 * A fake port instead of `vi.mock` on the repository module. The test now states the *contract* the
 * service depends on, so it keeps passing if the storage behind it is rewritten — which is the whole
 * point of the port. It also can't drift from reality unnoticed: the object must satisfy
 * TransactionsPort, so adding a method to the port breaks this file at compile time, not at runtime.
 */
function fakeTransactions(overrides: Partial<TransactionsPort> = {}): TransactionsPort {
  return {
    list: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(SAMPLE_TRANSACTION),
    update: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("getTransactions", () => {
  it("passes the caller's uid and the optional symbol filter straight through to the port", async () => {
    const transactions = fakeTransactions({ list: vi.fn().mockResolvedValue([SAMPLE_TRANSACTION]) });

    await expect(getTransactions("uid1", "2330", { transactions })).resolves.toEqual([SAMPLE_TRANSACTION]);
    expect(transactions.list).toHaveBeenCalledWith("uid1", "2330");
  });

  it("leaves the symbol filter undefined when the caller didn't supply one", async () => {
    const transactions = fakeTransactions();

    await getTransactions("uid1", undefined, { transactions });

    expect(transactions.list).toHaveBeenCalledWith("uid1", undefined);
  });
});

describe("addTransaction", () => {
  it('rejects an action that is neither "BUY" nor "SELL"', async () => {
    const transactions = fakeTransactions();

    await expect(
      addTransaction("uid1", { ...VALID_INPUT, action: "HOLD" as never }, { transactions }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transactions.create).not.toHaveBeenCalled();
  });

  it("rejects a non-positive-integer quantity", async () => {
    const transactions = fakeTransactions();

    await expect(addTransaction("uid1", { ...VALID_INPUT, quantity: 0 }, { transactions })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(addTransaction("uid1", { ...VALID_INPUT, quantity: 1.5 }, { transactions })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects a non-positive price", async () => {
    const transactions = fakeTransactions();

    await expect(addTransaction("uid1", { ...VALID_INPUT, price: 0 }, { transactions })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects a negative fee or tax (zero is allowed)", async () => {
    const transactions = fakeTransactions();

    await expect(addTransaction("uid1", { ...VALID_INPUT, fee: -1 }, { transactions })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(addTransaction("uid1", { ...VALID_INPUT, tax: -1 }, { transactions })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects a malformed tradeDate", async () => {
    const transactions = fakeTransactions();

    await expect(
      addTransaction("uid1", { ...VALID_INPUT, tradeDate: "2026/08/30" }, { transactions }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      addTransaction("uid1", { ...VALID_INPUT, tradeDate: "not-a-date" }, { transactions }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("creates the transaction once every field validates", async () => {
    const transactions = fakeTransactions();

    const result = await addTransaction("uid1", VALID_INPUT, { transactions });

    expect(result).toEqual(SAMPLE_TRANSACTION);
    expect(transactions.create).toHaveBeenCalledWith("uid1", VALID_INPUT);
  });
});

describe("getTransactionOrThrow", () => {
  // "missing" and "belongs to someone else" are deliberately the same answer — see the port's docs.
  it("throws a 404 when the transaction doesn't exist (or belongs to a different user)", async () => {
    const transactions = fakeTransactions();

    await expect(getTransactionOrThrow("uid1", "missing-uuid", { transactions })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns the transaction when found", async () => {
    const transactions = fakeTransactions({ find: vi.fn().mockResolvedValue(SAMPLE_TRANSACTION) });

    await expect(getTransactionOrThrow("uid1", SAMPLE_ID, { transactions })).resolves.toEqual(SAMPLE_TRANSACTION);
  });
});

describe("editTransaction", () => {
  it("rejects invalid fields before reaching the port", async () => {
    const transactions = fakeTransactions();

    await expect(editTransaction("uid1", SAMPLE_ID, { quantity: -1 }, { transactions })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(editTransaction("uid1", SAMPLE_ID, { tradeDate: "bad" }, { transactions })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(transactions.update).not.toHaveBeenCalled();
  });

  it("throws a 404 when the update matched no row", async () => {
    const transactions = fakeTransactions();

    await expect(editTransaction("uid1", SAMPLE_ID, { note: "x" }, { transactions })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns the updated transaction on success", async () => {
    const updated = { ...SAMPLE_TRANSACTION, quantity: 500 };
    const transactions = fakeTransactions({ update: vi.fn().mockResolvedValue(updated) });

    await expect(editTransaction("uid1", SAMPLE_ID, { quantity: 500 }, { transactions })).resolves.toEqual(updated);
    expect(transactions.update).toHaveBeenCalledWith("uid1", SAMPLE_ID, { quantity: 500 });
  });
});

describe("removeTransaction", () => {
  it("throws a 404 when nothing was deleted", async () => {
    const transactions = fakeTransactions();

    await expect(removeTransaction("uid1", SAMPLE_ID, { transactions })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("resolves silently when the row was deleted", async () => {
    const transactions = fakeTransactions({ remove: vi.fn().mockResolvedValue(true) });

    await expect(removeTransaction("uid1", SAMPLE_ID, { transactions })).resolves.toBeUndefined();
  });
});
