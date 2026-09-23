import { describe, expect, it, vi } from "vitest";
import type { HoldingsPort } from "@/application/ports/holdings.js";
import {
  addHolding,
  editHolding,
  getHoldingOrThrow,
  getHoldings,
  removeHolding,
} from "@/application/holdings/holdings.service.js";

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

/**
 * A fake port instead of `vi.mock` on the repository module. The test now states the *contract* the
 * service depends on, so it keeps passing if the storage behind it is rewritten — which is the whole
 * point of the port. It also can't drift from reality unnoticed: the object must satisfy HoldingsPort,
 * so adding a method to the port breaks this file at compile time rather than at runtime.
 */
function fakeHoldings(overrides: Partial<HoldingsPort> = {}): HoldingsPort {
  return {
    list: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ ok: true, holding: SAMPLE_HOLDING }),
    update: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("getHoldings", () => {
  it("passes the caller's uid straight through to the port", async () => {
    const holdings = fakeHoldings({ list: vi.fn().mockResolvedValue([SAMPLE_HOLDING]) });

    await expect(getHoldings("uid1", { holdings })).resolves.toEqual([SAMPLE_HOLDING]);
    expect(holdings.list).toHaveBeenCalledWith("uid1");
  });
});

describe("addHolding", () => {
  it("rejects a non-positive-integer quantity without touching the port", async () => {
    const holdings = fakeHoldings();

    await expect(addHolding("uid1", "2330", 0, 550.5, null, { holdings })).rejects.toMatchObject({ statusCode: 400 });
    await expect(addHolding("uid1", "2330", 1.5, 550.5, null, { holdings })).rejects.toMatchObject({ statusCode: 400 });
    expect(holdings.create).not.toHaveBeenCalled();
  });

  it("rejects a negative averageCost without touching the port", async () => {
    const holdings = fakeHoldings();

    await expect(addHolding("uid1", "2330", 1000, -1, null, { holdings })).rejects.toMatchObject({ statusCode: 400 });
    expect(holdings.create).not.toHaveBeenCalled();
  });

  it("creates the holding once the symbol and values are valid", async () => {
    const holdings = fakeHoldings();

    const result = await addHolding("uid1", "2330", 1000, 550.5, null, { holdings });

    expect(result).toEqual(SAMPLE_HOLDING);
    expect(holdings.create).toHaveBeenCalledWith("uid1", "2330", 1000, 550.5, null);
  });

  // The duplicate case arrives as a value, not as a Prisma error. Before the ports refactor this
  // assertion had to construct a PrismaClientKnownRequestError with code "P2002" — a test that proved
  // the service understood one driver's error taxonomy rather than proving the 409 rule.
  it("turns a duplicate into a 409 without knowing anything about the database", async () => {
    const holdings = fakeHoldings({ create: vi.fn().mockResolvedValue({ ok: false, reason: "duplicate" }) });

    await expect(addHolding("uid1", "2330", 1000, 550.5, null, { holdings })).rejects.toMatchObject({
      statusCode: 409,
      message: 'You already have a holding for "2330" — edit it instead',
    });
  });

  it("lets an unexpected storage failure propagate untouched", async () => {
    const holdings = fakeHoldings({ create: vi.fn().mockRejectedValue(new Error("connection lost")) });

    await expect(addHolding("uid1", "2330", 1000, 550.5, null, { holdings })).rejects.toThrow("connection lost");
  });
});

describe("getHoldingOrThrow", () => {
  // "missing" and "belongs to someone else" are deliberately the same answer — see the port's docs.
  it("throws a 404 when the holding doesn't exist (or belongs to a different user)", async () => {
    const holdings = fakeHoldings();

    await expect(getHoldingOrThrow("uid1", "missing-uuid", { holdings })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the holding when found", async () => {
    const holdings = fakeHoldings({ find: vi.fn().mockResolvedValue(SAMPLE_HOLDING) });

    await expect(getHoldingOrThrow("uid1", SAMPLE_ID, { holdings })).resolves.toEqual(SAMPLE_HOLDING);
  });
});

describe("editHolding", () => {
  it("rejects an invalid quantity/averageCost before reaching the port", async () => {
    const holdings = fakeHoldings();

    await expect(editHolding("uid1", SAMPLE_ID, { quantity: -5 }, { holdings })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(editHolding("uid1", SAMPLE_ID, { averageCost: -1 }, { holdings })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(holdings.update).not.toHaveBeenCalled();
  });

  it("throws a 404 when the update matched no row", async () => {
    const holdings = fakeHoldings();

    await expect(editHolding("uid1", SAMPLE_ID, { note: "x" }, { holdings })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns the updated holding on success", async () => {
    const updated = { ...SAMPLE_HOLDING, quantity: 2000 };
    const holdings = fakeHoldings({ update: vi.fn().mockResolvedValue(updated) });

    await expect(editHolding("uid1", SAMPLE_ID, { quantity: 2000 }, { holdings })).resolves.toEqual(updated);
    expect(holdings.update).toHaveBeenCalledWith("uid1", SAMPLE_ID, { quantity: 2000 });
  });
});

describe("removeHolding", () => {
  it("throws a 404 when nothing was deleted", async () => {
    const holdings = fakeHoldings();

    await expect(removeHolding("uid1", SAMPLE_ID, { holdings })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("resolves silently when the row was deleted", async () => {
    const holdings = fakeHoldings({ remove: vi.fn().mockResolvedValue(true) });

    await expect(removeHolding("uid1", SAMPLE_ID, { holdings })).resolves.toBeUndefined();
  });
});
