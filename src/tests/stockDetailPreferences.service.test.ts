import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domainBusiness/user/stockDetailPreferences.repository.js", () => ({
  findStockDetailPreferences: vi.fn(),
  upsertStockDetailPreferences: vi.fn(),
}));

import {
  findStockDetailPreferences,
  upsertStockDetailPreferences,
} from "@/domainBusiness/user/stockDetailPreferences.repository.js";
import {
  getStockDetailPreferences,
  updateStockDetailPreferences,
} from "@/domainBusiness/user/stockDetailPreferences.service.js";

describe("getStockDetailPreferences", () => {
  beforeEach(() => {
    vi.mocked(findStockDetailPreferences).mockReset();
  });

  // null (not a default-filled object) signals "no preference saved yet" for both fields — the frontend
  // applies its own local default, this service never materializes one.
  it("returns null mode/visibleCardIds when the user has no saved row", async () => {
    vi.mocked(findStockDetailPreferences).mockResolvedValue(null);

    const preferences = await getStockDetailPreferences("uid-1");

    expect(preferences).toEqual({ mode: null, visibleCardIds: null });
  });

  it("returns the user's explicitly saved list, including an intentionally empty one", async () => {
    vi.mocked(findStockDetailPreferences).mockResolvedValue({ mode: "CARD", visibleCardIds: [] });

    const preferences = await getStockDetailPreferences("uid-1");

    expect(preferences).toEqual({ mode: "CARD", visibleCardIds: [] });
  });

  it("returns the user's saved mode and card ids", async () => {
    vi.mocked(findStockDetailPreferences).mockResolvedValue({
      mode: "ACCOUNTING",
      visibleCardIds: ["profile", "revenue"],
    });

    const preferences = await getStockDetailPreferences("uid-1");

    expect(preferences).toEqual({ mode: "ACCOUNTING", visibleCardIds: ["profile", "revenue"] });
  });
});

describe("updateStockDetailPreferences", () => {
  beforeEach(() => {
    vi.mocked(upsertStockDetailPreferences).mockReset();
  });

  it("rejects a mode outside CARD/ACCOUNTING", async () => {
    await expect(updateStockDetailPreferences("uid-1", "EXPERT", ["profile"])).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(updateStockDetailPreferences("uid-1", undefined, ["profile"])).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(upsertStockDetailPreferences).not.toHaveBeenCalled();
  });

  it("rejects a non-array visibleCardIds", async () => {
    await expect(updateStockDetailPreferences("uid-1", "CARD", "profile")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(upsertStockDetailPreferences).not.toHaveBeenCalled();
  });

  it("rejects an array containing a non-string element", async () => {
    await expect(updateStockDetailPreferences("uid-1", "CARD", ["profile", 123])).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(upsertStockDetailPreferences).not.toHaveBeenCalled();
  });

  it("persists a valid mode and list together, without validating card id membership", async () => {
    vi.mocked(upsertStockDetailPreferences).mockResolvedValue({
      mode: "ACCOUNTING",
      visibleCardIds: ["profile", "some-brand-new-card-id"],
    });

    const preferences = await updateStockDetailPreferences("uid-1", "ACCOUNTING", [
      "profile",
      "some-brand-new-card-id",
    ]);

    expect(upsertStockDetailPreferences).toHaveBeenCalledWith("uid-1", "ACCOUNTING", [
      "profile",
      "some-brand-new-card-id",
    ]);
    expect(preferences).toEqual({ mode: "ACCOUNTING", visibleCardIds: ["profile", "some-brand-new-card-id"] });
  });

  // An intentionally empty list (user hid every card) must persist as [], not be rejected or coerced.
  it("persists an intentionally empty list", async () => {
    vi.mocked(upsertStockDetailPreferences).mockResolvedValue({ mode: "CARD", visibleCardIds: [] });

    const preferences = await updateStockDetailPreferences("uid-1", "CARD", []);

    expect(upsertStockDetailPreferences).toHaveBeenCalledWith("uid-1", "CARD", []);
    expect(preferences).toEqual({ mode: "CARD", visibleCardIds: [] });
  });
});
