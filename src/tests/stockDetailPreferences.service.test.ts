import { describe, expect, it, vi } from "vitest";
import { fakeUserPreferences } from "@/tests/fakes/userPreferences.js";
import {
  getStockDetailPreferences,
  updateStockDetailPreferences,
} from "@/application/user/stockDetailPreferences.service.js";

describe("getStockDetailPreferences", () => {
  // null (not a default-filled object) signals "no preference saved yet" for both fields — the frontend
  // applies its own local default, this service never materializes one.
  it("returns null mode/visibleCardIds when the user has no saved row", async () => {
    const userPreferences = fakeUserPreferences();

    const preferences = await getStockDetailPreferences("uid-1", { userPreferences });

    expect(preferences).toEqual({ mode: null, visibleCardIds: null });
    expect(userPreferences.getStockDetailPreferences).toHaveBeenCalledWith("uid-1");
  });

  it("returns the user's explicitly saved list, including an intentionally empty one", async () => {
    const userPreferences = fakeUserPreferences({
      getStockDetailPreferences: vi.fn().mockResolvedValue({ mode: "CARD", visibleCardIds: [] }),
    });

    const preferences = await getStockDetailPreferences("uid-1", { userPreferences });

    expect(preferences).toEqual({ mode: "CARD", visibleCardIds: [] });
  });

  it("returns the user's saved mode and card ids", async () => {
    const userPreferences = fakeUserPreferences({
      getStockDetailPreferences: vi
        .fn()
        .mockResolvedValue({ mode: "ACCOUNTING", visibleCardIds: ["profile", "revenue"] }),
    });

    const preferences = await getStockDetailPreferences("uid-1", { userPreferences });

    expect(preferences).toEqual({ mode: "ACCOUNTING", visibleCardIds: ["profile", "revenue"] });
  });
});

describe("updateStockDetailPreferences", () => {
  it("rejects a mode outside CARD/ACCOUNTING", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(
      updateStockDetailPreferences("uid-1", "EXPERT", ["profile"], { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      updateStockDetailPreferences("uid-1", undefined, ["profile"], { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.saveStockDetailPreferences).not.toHaveBeenCalled();
  });

  it("rejects a non-array visibleCardIds", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(
      updateStockDetailPreferences("uid-1", "CARD", "profile", { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.saveStockDetailPreferences).not.toHaveBeenCalled();
  });

  it("rejects an array containing a non-string element", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(
      updateStockDetailPreferences("uid-1", "CARD", ["profile", 123], { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.saveStockDetailPreferences).not.toHaveBeenCalled();
  });

  it("persists a valid mode and list together, without validating card id membership", async () => {
    const userPreferences = fakeUserPreferences({
      saveStockDetailPreferences: vi
        .fn()
        .mockResolvedValue({ mode: "ACCOUNTING", visibleCardIds: ["profile", "some-brand-new-card-id"] }),
    });

    const preferences = await updateStockDetailPreferences(
      "uid-1",
      "ACCOUNTING",
      ["profile", "some-brand-new-card-id"],
      { userPreferences },
    );

    expect(userPreferences.saveStockDetailPreferences).toHaveBeenCalledWith("uid-1", "ACCOUNTING", [
      "profile",
      "some-brand-new-card-id",
    ]);
    expect(preferences).toEqual({ mode: "ACCOUNTING", visibleCardIds: ["profile", "some-brand-new-card-id"] });
  });

  // An intentionally empty list (user hid every card) must persist as [], not be rejected or coerced.
  it("persists an intentionally empty list", async () => {
    const userPreferences = fakeUserPreferences({
      saveStockDetailPreferences: vi.fn().mockResolvedValue({ mode: "CARD", visibleCardIds: [] }),
    });

    const preferences = await updateStockDetailPreferences("uid-1", "CARD", [], { userPreferences });

    expect(userPreferences.saveStockDetailPreferences).toHaveBeenCalledWith("uid-1", "CARD", []);
    expect(preferences).toEqual({ mode: "CARD", visibleCardIds: [] });
  });
});
