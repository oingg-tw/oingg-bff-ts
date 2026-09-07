import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domainBusiness/user/preferredStocksPreferences.repository.js", () => ({
  findPreferredStocksPreferences: vi.fn(),
  upsertPreferredStocksPreferences: vi.fn(),
}));

import {
  findPreferredStocksPreferences,
  upsertPreferredStocksPreferences,
} from "@/domainBusiness/user/preferredStocksPreferences.repository.js";
import {
  getPreferredStocksPreferences,
  updatePreferredStocksPreferences,
} from "@/domainBusiness/user/preferredStocksPreferences.service.js";

describe("getPreferredStocksPreferences", () => {
  beforeEach(() => {
    vi.mocked(findPreferredStocksPreferences).mockReset();
  });

  it("returns null columnPresetId/columnOrder when the user has no saved row", async () => {
    vi.mocked(findPreferredStocksPreferences).mockResolvedValue(null);

    const preferences = await getPreferredStocksPreferences("uid-1");

    expect(preferences).toEqual({ columnPresetId: null, columnOrder: null });
  });

  it("returns the user's saved column preset and column order", async () => {
    vi.mocked(findPreferredStocksPreferences).mockResolvedValue({
      columnPresetId: "CONTRACT_TERMS",
      columnOrder: ["dividend-type", "participation", "issue-price"],
    });

    const preferences = await getPreferredStocksPreferences("uid-1");

    expect(preferences).toEqual({
      columnPresetId: "CONTRACT_TERMS",
      columnOrder: ["dividend-type", "participation", "issue-price"],
    });
  });
});

describe("updatePreferredStocksPreferences", () => {
  beforeEach(() => {
    vi.mocked(upsertPreferredStocksPreferences).mockReset();
  });

  it("rejects a columnPresetId outside ALL/CONTRACT_TERMS/VALUATION/CALL_RISK", async () => {
    await expect(updatePreferredStocksPreferences("uid-1", "GROWTH", ["dividend-type"])).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(updatePreferredStocksPreferences("uid-1", undefined, ["dividend-type"])).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(upsertPreferredStocksPreferences).not.toHaveBeenCalled();
  });

  // Regression guard: lowercase/mixed-case shouldn't slip through as a valid value even though it
  // "reads" the same — the wire contract is strictly the 4 SCREAMING_SNAKE_CASE values.
  it("rejects a lowercase columnPresetId even if it matches a valid value case-insensitively", async () => {
    await expect(updatePreferredStocksPreferences("uid-1", "contract_terms", ["dividend-type"])).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects a non-array columnOrder", async () => {
    await expect(updatePreferredStocksPreferences("uid-1", "ALL", "dividend-type")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(upsertPreferredStocksPreferences).not.toHaveBeenCalled();
  });

  it("rejects an array containing a non-string element", async () => {
    await expect(updatePreferredStocksPreferences("uid-1", "ALL", ["dividend-type", 123])).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(upsertPreferredStocksPreferences).not.toHaveBeenCalled();
  });

  it("persists a valid columnPresetId and columnOrder together, without validating column id membership", async () => {
    vi.mocked(upsertPreferredStocksPreferences).mockResolvedValue({
      columnPresetId: "VALUATION",
      columnOrder: ["issue-price", "some-brand-new-column-id"],
    });

    const preferences = await updatePreferredStocksPreferences("uid-1", "VALUATION", [
      "issue-price",
      "some-brand-new-column-id",
    ]);

    expect(upsertPreferredStocksPreferences).toHaveBeenCalledWith("uid-1", "VALUATION", [
      "issue-price",
      "some-brand-new-column-id",
    ]);
    expect(preferences).toEqual({
      columnPresetId: "VALUATION",
      columnOrder: ["issue-price", "some-brand-new-column-id"],
    });
  });

  it("persists an intentionally empty columnOrder", async () => {
    vi.mocked(upsertPreferredStocksPreferences).mockResolvedValue({ columnPresetId: "ALL", columnOrder: [] });

    const preferences = await updatePreferredStocksPreferences("uid-1", "ALL", []);

    expect(upsertPreferredStocksPreferences).toHaveBeenCalledWith("uid-1", "ALL", []);
    expect(preferences).toEqual({ columnPresetId: "ALL", columnOrder: [] });
  });
});
