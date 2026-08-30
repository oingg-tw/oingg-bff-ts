import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parsePagination } from "../domains/screener/pagination.js";

describe("parsePagination", () => {
  it("defaults to page 1 and the default page size when neither is given", () => {
    expect(parsePagination(undefined, undefined)).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("accepts numeric values (body) and numeric strings (query params) the same way", () => {
    expect(parsePagination(2, 10)).toEqual({ page: 2, pageSize: 10 });
    expect(parsePagination("2", "10")).toEqual({ page: 2, pageSize: 10 });
  });

  it.each([0, -1, 1.5, "abc", NaN])("rejects an invalid page value: %p", (value) => {
    expect(() => parsePagination(value, undefined)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it.each([0, -1, 1.5, "abc"])("rejects an invalid pageSize value: %p", (value) => {
    expect(() => parsePagination(undefined, value)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it(`rejects a pageSize above ${MAX_PAGE_SIZE}`, () => {
    expect(() => parsePagination(undefined, MAX_PAGE_SIZE + 1)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it(`accepts a pageSize of exactly ${MAX_PAGE_SIZE}`, () => {
    expect(parsePagination(undefined, MAX_PAGE_SIZE)).toEqual({ page: 1, pageSize: MAX_PAGE_SIZE });
  });
});
