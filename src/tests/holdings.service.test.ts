import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/stock/index.js", () => ({
  getStockQuote: vi.fn(),
}));

vi.mock("../domains/holdings/holdings.repository.js", () => ({
  createHolding: vi.fn(),
  deleteHolding: vi.fn(),
  findHolding: vi.fn(),
  listHoldings: vi.fn(),
  updateHolding: vi.fn(),
}));

import { Prisma } from "../generated/prisma/client.js";
import { getStockQuote } from "../domains/stock/index.js";
import {
  createHolding,
  deleteHolding,
  findHolding,
  updateHolding,
} from "../domains/holdings/holdings.repository.js";
import { addHolding, editHolding, getHoldingOrThrow, removeHolding } from "../domains/holdings/holdings.service.js";

const SAMPLE_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const SAMPLE_HOLDING = {
  id: SAMPLE_ID,
  symbol: "2330",
  quantity: 1000,
  averageCost: "550.5000",
  note: null,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

const SAMPLE_QUOTE = { symbol: "2330", price: null, valuation: null };

describe("addHolding", () => {
  beforeEachReset();

  it("rejects a non-positive-integer quantity without touching the database", async () => {
    await expect(addHolding("uid1", "2330", 0, 550.5, null)).rejects.toMatchObject({ statusCode: 400 });
    await expect(addHolding("uid1", "2330", 1.5, 550.5, null)).rejects.toMatchObject({ statusCode: 400 });
    expect(getStockQuote).not.toHaveBeenCalled();
  });

  it("rejects a negative averageCost without touching the database", async () => {
    await expect(addHolding("uid1", "2330", 1000, -1, null)).rejects.toMatchObject({ statusCode: 400 });
    expect(getStockQuote).not.toHaveBeenCalled();
  });

  it("rejects a symbol that doesn't exist in either market with a 404", async () => {
    vi.mocked(getStockQuote).mockResolvedValue(null);

    await expect(addHolding("uid1", "NOPE", 1000, 550.5, null)).rejects.toMatchObject({ statusCode: 404 });
    expect(createHolding).not.toHaveBeenCalled();
  });

  it("creates the holding once the symbol and values are valid", async () => {
    vi.mocked(getStockQuote).mockResolvedValue(SAMPLE_QUOTE);
    vi.mocked(createHolding).mockResolvedValue(SAMPLE_HOLDING);

    const result = await addHolding("uid1", "2330", 1000, 550.5, null);

    expect(result).toEqual(SAMPLE_HOLDING);
    expect(createHolding).toHaveBeenCalledWith("uid1", "2330", 1000, 550.5, null);
  });

  it("turns a duplicate-symbol conflict (Prisma P2002) into a 409 AppError", async () => {
    vi.mocked(getStockQuote).mockResolvedValue(SAMPLE_QUOTE);
    vi.mocked(createHolding).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );

    await expect(addHolding("uid1", "2330", 1000, 550.5, null)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("getHoldingOrThrow", () => {
  beforeEachReset();

  it("throws a 404 when the holding doesn't exist (or belongs to a different user)", async () => {
    vi.mocked(findHolding).mockResolvedValue(null);
    await expect(getHoldingOrThrow("uid1", "missing-uuid")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the holding when found", async () => {
    vi.mocked(findHolding).mockResolvedValue(SAMPLE_HOLDING);
    await expect(getHoldingOrThrow("uid1", SAMPLE_ID)).resolves.toEqual(SAMPLE_HOLDING);
  });
});

describe("editHolding", () => {
  beforeEachReset();

  it("rejects an invalid quantity/averageCost before hitting the database", async () => {
    await expect(editHolding("uid1", SAMPLE_ID, { quantity: -5 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(editHolding("uid1", SAMPLE_ID, { averageCost: -1 })).rejects.toMatchObject({ statusCode: 400 });
    expect(updateHolding).not.toHaveBeenCalled();
  });

  it("throws a 404 when the update matched no row", async () => {
    vi.mocked(updateHolding).mockResolvedValue(null);
    await expect(editHolding("uid1", SAMPLE_ID, { note: "x" })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the updated holding on success", async () => {
    const updated = { ...SAMPLE_HOLDING, quantity: 2000 };
    vi.mocked(updateHolding).mockResolvedValue(updated);
    await expect(editHolding("uid1", SAMPLE_ID, { quantity: 2000 })).resolves.toEqual(updated);
  });
});

describe("removeHolding", () => {
  beforeEachReset();

  it("throws a 404 when nothing was deleted", async () => {
    vi.mocked(deleteHolding).mockResolvedValue(false);
    await expect(removeHolding("uid1", SAMPLE_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("resolves silently when the row was deleted", async () => {
    vi.mocked(deleteHolding).mockResolvedValue(true);
    await expect(removeHolding("uid1", SAMPLE_ID)).resolves.toBeUndefined();
  });
});

function beforeEachReset() {
  beforeEach(() => {
    vi.mocked(getStockQuote).mockReset();
    vi.mocked(createHolding).mockReset();
    vi.mocked(findHolding).mockReset();
    vi.mocked(updateHolding).mockReset();
    vi.mocked(deleteHolding).mockReset();
  });
}
