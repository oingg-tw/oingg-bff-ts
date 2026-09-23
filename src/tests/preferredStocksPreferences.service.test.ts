import { describe, expect, it, vi } from "vitest";
import { fakeUserPreferences } from "@/tests/fakes/userPreferences.js";
import {
  getPreferredStocksPreferences,
  updatePreferredStocksPreferences,
} from "@/application/user/preferredStocksPreferences.service.js";

describe("getPreferredStocksPreferences", () => {
  it("returns null columnPresetId/columnOrder when the user has no saved row", async () => {
    const userPreferences = fakeUserPreferences();

    const preferences = await getPreferredStocksPreferences("uid-1", { userPreferences });

    expect(preferences).toEqual({ columnPresetId: null, columnOrder: null });
    expect(userPreferences.getPreferredStocksPreferences).toHaveBeenCalledWith("uid-1");
  });

  it("returns the user's saved column preset and column order", async () => {
    const userPreferences = fakeUserPreferences({
      getPreferredStocksPreferences: vi.fn().mockResolvedValue({
        columnPresetId: "CONTRACT_TERMS",
        columnOrder: ["dividend-type", "participation", "issue-price"],
      }),
    });

    const preferences = await getPreferredStocksPreferences("uid-1", { userPreferences });

    expect(preferences).toEqual({
      columnPresetId: "CONTRACT_TERMS",
      columnOrder: ["dividend-type", "participation", "issue-price"],
    });
  });
});

describe("updatePreferredStocksPreferences", () => {
  it("rejects a columnPresetId outside ALL/CONTRACT_TERMS/VALUATION/CALL_RISK", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(
      updatePreferredStocksPreferences("uid-1", "GROWTH", ["dividend-type"], { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      updatePreferredStocksPreferences("uid-1", undefined, ["dividend-type"], { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.savePreferredStocksPreferences).not.toHaveBeenCalled();
  });

  // Regression guard: lowercase/mixed-case shouldn't slip through as a valid value even though it
  // "reads" the same — the wire contract is strictly the 4 SCREAMING_SNAKE_CASE values.
  it("rejects a lowercase columnPresetId even if it matches a valid value case-insensitively", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(
      updatePreferredStocksPreferences("uid-1", "contract_terms", ["dividend-type"], { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a non-array columnOrder", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(
      updatePreferredStocksPreferences("uid-1", "ALL", "dividend-type", { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.savePreferredStocksPreferences).not.toHaveBeenCalled();
  });

  it("rejects an array containing a non-string element", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(
      updatePreferredStocksPreferences("uid-1", "ALL", ["dividend-type", 123], { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.savePreferredStocksPreferences).not.toHaveBeenCalled();
  });

  it("persists a valid columnPresetId and columnOrder together, without validating column id membership", async () => {
    const userPreferences = fakeUserPreferences({
      savePreferredStocksPreferences: vi.fn().mockResolvedValue({
        columnPresetId: "VALUATION",
        columnOrder: ["issue-price", "some-brand-new-column-id"],
      }),
    });

    const preferences = await updatePreferredStocksPreferences(
      "uid-1",
      "VALUATION",
      ["issue-price", "some-brand-new-column-id"],
      { userPreferences },
    );

    expect(userPreferences.savePreferredStocksPreferences).toHaveBeenCalledWith("uid-1", "VALUATION", [
      "issue-price",
      "some-brand-new-column-id",
    ]);
    expect(preferences).toEqual({
      columnPresetId: "VALUATION",
      columnOrder: ["issue-price", "some-brand-new-column-id"],
    });
  });

  it("persists an intentionally empty columnOrder", async () => {
    const userPreferences = fakeUserPreferences({
      savePreferredStocksPreferences: vi.fn().mockResolvedValue({ columnPresetId: "ALL", columnOrder: [] }),
    });

    const preferences = await updatePreferredStocksPreferences("uid-1", "ALL", [], { userPreferences });

    expect(userPreferences.savePreferredStocksPreferences).toHaveBeenCalledWith("uid-1", "ALL", []);
    expect(preferences).toEqual({ columnPresetId: "ALL", columnOrder: [] });
  });
});
