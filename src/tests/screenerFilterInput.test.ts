import { describe, expect, it } from "vitest";
import { parseSort } from "@/domains/screener/screenerFilterInput.js";

describe("parseSort", () => {
  it("returns undefined when neither sortField nor sortOrder is given", () => {
    expect(parseSort(undefined, undefined)).toBeUndefined();
  });

  it("returns the parsed sort when both are given", () => {
    expect(parseSort("roe.roeTtmPct", "desc")).toEqual({ field: "roe.roeTtmPct", order: "desc" });
    expect(parseSort("symbol", "asc")).toEqual({ field: "symbol", order: "asc" });
  });

  // analysis-ts requires both or neither — failing fast here avoids the round trip, same validation
  // they'd do on their side anyway.
  it("rejects sortField given without sortOrder", () => {
    expect(() => parseSort("roe.roeTtmPct", undefined)).toThrow(/must be given together/);
  });

  it("rejects sortOrder given without sortField", () => {
    expect(() => parseSort(undefined, "asc")).toThrow(/must be given together/);
  });

  it("rejects a non-string sortField", () => {
    expect(() => parseSort(123, "asc")).toThrow(/must be a non-empty string/);
  });

  it("rejects an empty-string sortField", () => {
    expect(() => parseSort("  ", "asc")).toThrow(/must be a non-empty string/);
  });

  it('rejects a sortOrder that is not "asc" or "desc"', () => {
    expect(() => parseSort("symbol", "ascending")).toThrow(/must be "asc" or "desc"/);
  });
});
