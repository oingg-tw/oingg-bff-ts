import { describe, expect, it, vi } from "vitest";
import type { WatchlistPort } from "@/application/ports/watchlist.js";
import {
  addWatchlistItem,
  editWatchlistItemNote,
  getWatchlist,
  getWatchlistItemOrThrow,
  removeWatchlistItem,
} from "@/application/watchlist/watchlist.service.js";

const SAMPLE_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const SAMPLE_ITEM = {
  id: SAMPLE_ID,
  symbol: "2330",
  note: null,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
};

/**
 * A fake port instead of `vi.mock` on the repository module. The test now states the *contract* the
 * service depends on, so it keeps passing if the storage behind it is rewritten — which is the whole
 * point of the port. It also can't drift from reality unnoticed: the object must satisfy WatchlistPort,
 * so adding a method to the port breaks this file at compile time rather than at runtime.
 */
function fakeWatchlist(overrides: Partial<WatchlistPort> = {}): WatchlistPort {
  return {
    list: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({ ok: true, item: SAMPLE_ITEM }),
    updateNote: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("getWatchlist", () => {
  it("passes the caller's uid straight through to the port", async () => {
    const watchlist = fakeWatchlist({ list: vi.fn().mockResolvedValue([SAMPLE_ITEM]) });

    await expect(getWatchlist("uid1", { watchlist })).resolves.toEqual([SAMPLE_ITEM]);
    expect(watchlist.list).toHaveBeenCalledWith("uid1");
  });
});

describe("addWatchlistItem", () => {
  it("creates the item", async () => {
    const watchlist = fakeWatchlist();

    const result = await addWatchlistItem("uid1", "2330", "watching for a dip", { watchlist });

    expect(result).toEqual(SAMPLE_ITEM);
    expect(watchlist.create).toHaveBeenCalledWith("uid1", "2330", "watching for a dip");
  });

  // The duplicate case arrives as a value, not as a Prisma error. Before the ports refactor this
  // assertion had to construct a PrismaClientKnownRequestError with code "P2002" — a test that proved
  // the service understood one driver's error taxonomy rather than proving the 409 rule.
  it("turns a duplicate into a 409 without knowing anything about the database", async () => {
    const watchlist = fakeWatchlist({ create: vi.fn().mockResolvedValue({ ok: false, reason: "duplicate" }) });

    await expect(addWatchlistItem("uid1", "2330", null, { watchlist })).rejects.toMatchObject({
      statusCode: 409,
      message: '"2330" is already in your watchlist',
    });
  });

  it("lets an unexpected storage failure propagate untouched", async () => {
    const watchlist = fakeWatchlist({ create: vi.fn().mockRejectedValue(new Error("connection lost")) });

    await expect(addWatchlistItem("uid1", "2330", null, { watchlist })).rejects.toThrow("connection lost");
  });
});

describe("getWatchlistItemOrThrow", () => {
  it("returns the item when it exists", async () => {
    const watchlist = fakeWatchlist({ find: vi.fn().mockResolvedValue(SAMPLE_ITEM) });

    await expect(getWatchlistItemOrThrow("uid1", SAMPLE_ID, { watchlist })).resolves.toEqual(SAMPLE_ITEM);
  });

  // "missing" and "belongs to someone else" are deliberately the same answer — see the port's docs.
  it("404s when the item is missing or not the caller's", async () => {
    const watchlist = fakeWatchlist();

    await expect(getWatchlistItemOrThrow("uid1", SAMPLE_ID, { watchlist })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("editWatchlistItemNote", () => {
  it("returns the updated item", async () => {
    const updated = { ...SAMPLE_ITEM, note: "updated" };
    const watchlist = fakeWatchlist({ updateNote: vi.fn().mockResolvedValue(updated) });

    await expect(editWatchlistItemNote("uid1", SAMPLE_ID, "updated", { watchlist })).resolves.toEqual(updated);
    expect(watchlist.updateNote).toHaveBeenCalledWith("uid1", SAMPLE_ID, "updated");
  });

  it("404s when nothing was updated", async () => {
    const watchlist = fakeWatchlist();

    await expect(editWatchlistItemNote("uid1", SAMPLE_ID, "x", { watchlist })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("removeWatchlistItem", () => {
  it("resolves when a row was deleted", async () => {
    const watchlist = fakeWatchlist({ remove: vi.fn().mockResolvedValue(true) });

    await expect(removeWatchlistItem("uid1", SAMPLE_ID, { watchlist })).resolves.toBeUndefined();
  });

  it("404s when nothing was deleted", async () => {
    const watchlist = fakeWatchlist();

    await expect(removeWatchlistItem("uid1", SAMPLE_ID, { watchlist })).rejects.toMatchObject({ statusCode: 404 });
  });
});
