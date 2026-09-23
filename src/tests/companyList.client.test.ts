import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompanyList } from "@/domainBff/stock/companyList.client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FILTERS_URL = process.env.FILTERS_SERVICE_URL;

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://filters.test";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_FILTERS_URL === undefined) {
    delete process.env.FILTERS_SERVICE_URL;
  } else {
    process.env.FILTERS_SERVICE_URL = ORIGINAL_FILTERS_URL;
  }
});

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  }) as unknown as typeof fetch;
}

// Real shape given directly by analysis-ts (2026-09-11): companyName, not name, on the wire.
// market/sectorCode/sectorName added 2026-09-19; isEmerging 2026-09-23 (always present, never null).
const RAW_BODY = {
  count: 2650,
  limit: 200,
  offset: 0,
  entries: [
    { symbol: "000700", companyName: "兆豐證券", market: "TWSE", sectorCode: null, sectorName: null, isEmerging: false },
    { symbol: "2330", companyName: "台積電", market: "TWSE", sectorCode: "24", sectorName: "半導體業", isEmerging: false },
  ],
};

describe("fetchCompanyList", () => {
  it("requests /companies with no query params by default and renames companyName to name", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchCompanyList();

    expect(result).toEqual({
      count: 2650,
      limit: 200,
      offset: 0,
      entries: [
        { symbol: "000700", name: "兆豐證券", market: "TWSE", sectorCode: null, sectorName: null, isEmerging: false },
        { symbol: "2330", name: "台積電", market: "TWSE", sectorCode: "24", sectorName: "半導體業", isEmerging: false },
      ],
    });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies");
  });

  // isEmerging is upstream-guaranteed non-null, but a malformed response must not silently read as
  // "not 興櫃" — that would quietly re-inflate any coverage denominator built on this directory.
  it("passes through isEmerging:true and treats a non-boolean as false", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        ...RAW_BODY,
        entries: [
          { symbol: "6548", companyName: "長科*", market: "TPEx", sectorCode: null, sectorName: null, isEmerging: true },
          { symbol: "9999", companyName: "壞掉的列", market: "TPEx", sectorCode: null, sectorName: null },
        ],
      },
    });

    const result = await fetchCompanyList();

    expect(result.entries[0]?.isEmerging).toBe(true);
    expect(result.entries[1]?.isEmerging).toBe(false);
  });

  it("includes limit/offset in the request when given", async () => {
    mockFetchOnce({ ok: true, body: { ...RAW_BODY, limit: 5, offset: 10 } });

    await fetchCompanyList(5, 10);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies?limit=5&offset=10");
  });

  // Confirmed live (2026-09-11): an offset past the total count is still a 200 with an empty entries
  // array, not an error — must not be treated as a fetch failure.
  it("returns an empty entries array without throwing when offset is past the total count", async () => {
    mockFetchOnce({ ok: true, body: { count: 2650, limit: 5, offset: 3000, entries: [] } });

    await expect(fetchCompanyList(5, 3000)).resolves.toEqual({ count: 2650, limit: 5, offset: 3000, entries: [] });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchCompanyList()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchCompanyList()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing count/limit/offset/entries", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await expect(fetchCompanyList()).rejects.toMatchObject({ statusCode: 502 });
  });
});
