import { describe, expect, it } from "vitest";
import {
  parseEtfColumns,
  parseEtfScreenerFilters,
  parseEtfScreenerPagination,
  parseEtfSort,
} from "@/domains/etfScreener/etfScreenerInput.js";

describe("parseEtfScreenerFilters", () => {
  it("returns an empty array when filters is undefined", () => {
    expect(parseEtfScreenerFilters(undefined)).toEqual([]);
  });

  it("rejects a non-array value", () => {
    expect(() => parseEtfScreenerFilters("nope")).toThrow(/must be an array/);
  });

  it("rejects a filter missing field", () => {
    expect(() => parseEtfScreenerFilters([{ min: 1 }])).toThrow(/field is required/);
  });

  it("parses a numeric filter, defaulting exclude to false", () => {
    expect(parseEtfScreenerFilters([{ field: "aum", min: 1000, max: null }])).toEqual([
      { field: "aum", min: 1000, max: null, exclude: false },
    ]);
  });

  it("parses a numeric filter's explicit exclude", () => {
    expect(parseEtfScreenerFilters([{ field: "aum", min: 1000, max: null, exclude: true }])).toEqual([
      { field: "aum", min: 1000, max: null, exclude: true },
    ]);
  });

  it("rejects a non-boolean exclude", () => {
    expect(() => parseEtfScreenerFilters([{ field: "aum", min: 1, max: null, exclude: "yes" }])).toThrow(
      /exclude must be a boolean/,
    );
  });

  it("rejects a non-number min/max", () => {
    expect(() => parseEtfScreenerFilters([{ field: "aum", min: "1000", max: null }])).toThrow(/must be a number or null/);
  });

  // `values`'s presence is the discriminator for a categorical filter — min/max aren't required or read.
  it("parses a categorical filter (values array)", () => {
    expect(parseEtfScreenerFilters([{ field: "market", values: ["TWSE", "TPEx"] }])).toEqual([
      { field: "market", values: ["TWSE", "TPEx"] },
    ]);
  });

  it("rejects a categorical filter whose values isn't an array of strings", () => {
    expect(() => parseEtfScreenerFilters([{ field: "market", values: "TWSE" }])).toThrow(
      /values must be an array of strings/,
    );
    expect(() => parseEtfScreenerFilters([{ field: "market", values: [1, 2] }])).toThrow(
      /values must be an array of strings/,
    );
  });
});

describe("parseEtfColumns", () => {
  it("returns an empty array when columns is undefined", () => {
    expect(parseEtfColumns(undefined)).toEqual([]);
  });

  it("rejects a non-array value", () => {
    expect(() => parseEtfColumns("nope")).toThrow(/must be an array/);
  });

  it("parses column refs", () => {
    expect(parseEtfColumns([{ field: "aum" }, { field: "expenseRatio" }])).toEqual([
      { field: "aum" },
      { field: "expenseRatio" },
    ]);
  });

  it("rejects a column missing field", () => {
    expect(() => parseEtfColumns([{}])).toThrow(/field is required/);
  });
});

describe("parseEtfSort", () => {
  it("returns undefined when neither sortField nor sortOrder is given", () => {
    expect(parseEtfSort(undefined, undefined)).toBeUndefined();
  });

  it("returns the parsed sort when both are given", () => {
    expect(parseEtfSort("aum", "desc")).toEqual({ field: "aum", order: "desc" });
  });

  it("rejects sortField given without sortOrder", () => {
    expect(() => parseEtfSort("aum", undefined)).toThrow(/must be given together/);
  });

  it('rejects a sortOrder that is not "asc" or "desc"', () => {
    expect(() => parseEtfSort("aum", "ascending")).toThrow(/must be "asc" or "desc"/);
  });
});

describe("parseEtfScreenerPagination", () => {
  it("defaults page to 1 and pageSize to 50", () => {
    expect(parseEtfScreenerPagination(undefined, undefined)).toEqual({ page: 1, pageSize: 50 });
  });

  it("parses given page/pageSize", () => {
    expect(parseEtfScreenerPagination(3, 20)).toEqual({ page: 3, pageSize: 20 });
  });

  it("rejects pageSize over 200", () => {
    expect(() => parseEtfScreenerPagination(1, 201)).toThrow(/must be at most 200/);
  });

  it("rejects a non-positive-integer page", () => {
    expect(() => parseEtfScreenerPagination(0, 50)).toThrow(/must be a positive integer/);
    expect(() => parseEtfScreenerPagination(1.5, 50)).toThrow(/must be a positive integer/);
  });
});
