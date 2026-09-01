import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/stock/index.js", () => ({
  getStockQuote: vi.fn(),
}));

vi.mock("../domains/watchlist/watchlist.repository.js", () => ({
  createWatchlistItem: vi.fn(),
  deleteWatchlistItem: vi.fn(),
  findWatchlistItem: vi.fn(),
  listWatchlistItems: vi.fn(),
  updateWatchlistItemNote: vi.fn(),
}));

import { Prisma } from "../generated/prisma/client.js";
import { getStockQuote } from "../domains/stock/index.js";
import {
  createWatchlistItem,
  deleteWatchlistItem,
  findWatchlistItem,
  updateWatchlistItemNote,
} from "../domains/watchlist/watchlist.repository.js";
import {
  addWatchlistItem,
  editWatchlistItemNote,
  getWatchlistItemOrThrow,
  removeWatchlistItem,
} from "../domains/watchlist/watchlist.service.js";

const SAMPLE_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const SAMPLE_ITEM = {
  id: SAMPLE_ID,
  symbol: "2330",
  note: null,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
};

const SAMPLE_QUOTE = { symbol: "2330", price: null, valuation: null };

describe("addWatchlistItem", () => {
  beforeEach(() => {
    vi.mocked(getStockQuote).mockReset();
    vi.mocked(createWatchlistItem).mockReset();
  });

  it("rejects a symbol that doesn't exist in either market with a 404, without touching the database", async () => {
    vi.mocked(getStockQuote).mockResolvedValue(null);

    await expect(addWatchlistItem("uid1", "NOPE", null)).rejects.toMatchObject({ statusCode: 404 });
    expect(createWatchlistItem).not.toHaveBeenCalled();
  });

  it("creates the item once the symbol is confirmed to exist", async () => {
    vi.mocked(getStockQuote).mockResolvedValue(SAMPLE_QUOTE);
    vi.mocked(createWatchlistItem).mockResolvedValue(SAMPLE_ITEM);

    const result = await addWatchlistItem("uid1", "2330", "watching for a dip");

    expect(result).toEqual(SAMPLE_ITEM);
    expect(createWatchlistItem).toHaveBeenCalledWith("uid1", "2330", "watching for a dip");
  });

  // Regression test: Prisma wraps a unique-constraint violation as PrismaClientKnownRequestError
  // with code "P2002" — NOT Postgres's raw "23505" that a hand-written pg query would throw.
  // Checking for the wrong code silently let the raw Prisma error escape as an unhandled 500
  // instead of the intended 409, which is exactly what happened before this was fixed.
  it("turns a duplicate-symbol conflict (Prisma P2002) into a 409 AppError", async () => {
    vi.mocked(getStockQuote).mockResolvedValue(SAMPLE_QUOTE);
    vi.mocked(createWatchlistItem).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    await expect(addWatchlistItem("uid1", "2330", null)).rejects.toMatchObject({
      statusCode: 409,
      message: '"2330" is already in your watchlist',
    });
  });

  it("does not mask database errors that aren't a unique-constraint violation", async () => {
    vi.mocked(getStockQuote).mockResolvedValue(SAMPLE_QUOTE);
    const dbError = new Error("connection reset");
    vi.mocked(createWatchlistItem).mockRejectedValue(dbError);

    await expect(addWatchlistItem("uid1", "2330", null)).rejects.toBe(dbError);
  });
});

describe("getWatchlistItemOrThrow", () => {
  beforeEach(() => {
    vi.mocked(findWatchlistItem).mockReset();
  });

  it("throws a 404 when the item doesn't exist (or belongs to a different user)", async () => {
    vi.mocked(findWatchlistItem).mockResolvedValue(null);

    await expect(getWatchlistItemOrThrow("uid1", "missing-uuid")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the item when found", async () => {
    vi.mocked(findWatchlistItem).mockResolvedValue(SAMPLE_ITEM);

    await expect(getWatchlistItemOrThrow("uid1", SAMPLE_ID)).resolves.toEqual(SAMPLE_ITEM);
  });
});

describe("editWatchlistItemNote", () => {
  it("throws a 404 when the update matched no row (wrong owner or missing id)", async () => {
    vi.mocked(updateWatchlistItemNote).mockReset().mockResolvedValue(null);

    await expect(editWatchlistItemNote("uid1", SAMPLE_ID, "new note")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the updated item on success", async () => {
    const updated = { ...SAMPLE_ITEM, note: "new note" };
    vi.mocked(updateWatchlistItemNote).mockReset().mockResolvedValue(updated);

    await expect(editWatchlistItemNote("uid1", SAMPLE_ID, "new note")).resolves.toEqual(updated);
  });
});

describe("removeWatchlistItem", () => {
  it("throws a 404 when nothing was deleted", async () => {
    vi.mocked(deleteWatchlistItem).mockReset().mockResolvedValue(false);

    await expect(removeWatchlistItem("uid1", SAMPLE_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("resolves silently when the row was deleted", async () => {
    vi.mocked(deleteWatchlistItem).mockReset().mockResolvedValue(true);

    await expect(removeWatchlistItem("uid1", SAMPLE_ID)).resolves.toBeUndefined();
  });
});
