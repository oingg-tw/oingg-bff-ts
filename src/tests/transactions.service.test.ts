import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/business/transactions/transactions.repository.js", () => ({
  createTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  findTransaction: vi.fn(),
  listTransactions: vi.fn(),
  updateTransaction: vi.fn(),
}));

import {
  createTransaction,
  deleteTransaction,
  findTransaction,
  updateTransaction,
} from "@/business/transactions/transactions.repository.js";
import {
  addTransaction,
  editTransaction,
  getTransactionOrThrow,
  removeTransaction,
} from "@/business/transactions/transactions.service.js";

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

beforeEach(() => {
  vi.mocked(createTransaction).mockReset();
  vi.mocked(findTransaction).mockReset();
  vi.mocked(updateTransaction).mockReset();
  vi.mocked(deleteTransaction).mockReset();
});

describe("addTransaction", () => {
  it('rejects an action that is neither "BUY" nor "SELL"', async () => {
    await expect(
      addTransaction("uid1", { ...VALID_INPUT, action: "HOLD" as never }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it("rejects a non-positive-integer quantity", async () => {
    await expect(addTransaction("uid1", { ...VALID_INPUT, quantity: 0 })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(addTransaction("uid1", { ...VALID_INPUT, quantity: 1.5 })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects a non-positive price", async () => {
    await expect(addTransaction("uid1", { ...VALID_INPUT, price: 0 })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a negative fee or tax (zero is allowed)", async () => {
    await expect(addTransaction("uid1", { ...VALID_INPUT, fee: -1 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(addTransaction("uid1", { ...VALID_INPUT, tax: -1 })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a malformed tradeDate", async () => {
    await expect(addTransaction("uid1", { ...VALID_INPUT, tradeDate: "2026/08/30" })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(addTransaction("uid1", { ...VALID_INPUT, tradeDate: "not-a-date" })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("creates the transaction once every field validates", async () => {
    vi.mocked(createTransaction).mockResolvedValue(SAMPLE_TRANSACTION);

    const result = await addTransaction("uid1", VALID_INPUT);

    expect(result).toEqual(SAMPLE_TRANSACTION);
    expect(createTransaction).toHaveBeenCalledWith("uid1", VALID_INPUT);
  });
});

describe("getTransactionOrThrow", () => {
  it("throws a 404 when the transaction doesn't exist (or belongs to a different user)", async () => {
    vi.mocked(findTransaction).mockResolvedValue(null);
    await expect(getTransactionOrThrow("uid1", "missing-uuid")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the transaction when found", async () => {
    vi.mocked(findTransaction).mockResolvedValue(SAMPLE_TRANSACTION);
    await expect(getTransactionOrThrow("uid1", SAMPLE_ID)).resolves.toEqual(SAMPLE_TRANSACTION);
  });
});

describe("editTransaction", () => {
  it("rejects invalid fields before hitting the database", async () => {
    await expect(editTransaction("uid1", SAMPLE_ID, { quantity: -1 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(editTransaction("uid1", SAMPLE_ID, { tradeDate: "bad" })).rejects.toMatchObject({ statusCode: 400 });
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it("throws a 404 when the update matched no row", async () => {
    vi.mocked(updateTransaction).mockResolvedValue(null);
    await expect(editTransaction("uid1", SAMPLE_ID, { note: "x" })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the updated transaction on success", async () => {
    const updated = { ...SAMPLE_TRANSACTION, quantity: 500 };
    vi.mocked(updateTransaction).mockResolvedValue(updated);
    await expect(editTransaction("uid1", SAMPLE_ID, { quantity: 500 })).resolves.toEqual(updated);
  });
});

describe("removeTransaction", () => {
  it("throws a 404 when nothing was deleted", async () => {
    vi.mocked(deleteTransaction).mockResolvedValue(false);
    await expect(removeTransaction("uid1", SAMPLE_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("resolves silently when the row was deleted", async () => {
    vi.mocked(deleteTransaction).mockResolvedValue(true);
    await expect(removeTransaction("uid1", SAMPLE_ID)).resolves.toBeUndefined();
  });
});
