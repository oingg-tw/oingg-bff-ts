import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSecurityList } from "@/infrastructure/analysisApi/securities/securities.client.js";

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
// `type` added by analysis-ts the same day (commit 46df7ef) so callers can route search results without
// guessing from the symbol shape.
const RAW_BODY = {
  count: 2716,
  limit: 200,
  offset: 0,
  entries: [
    { symbol: "2330", companyName: "台積電", type: "COMMON" },
    { symbol: "2881A", companyName: "富邦特", type: "PREFERRED" },
    { symbol: "0050", companyName: "元大台灣50", type: "ETF" },
  ],
};

describe("fetchSecurityList", () => {
  it("requests /securities with no query params by default, renames companyName to name, and keeps type", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchSecurityList();

    expect(result).toEqual({
      count: 2716,
      limit: 200,
      offset: 0,
      entries: [
        { symbol: "2330", name: "台積電", type: "COMMON" },
        { symbol: "2881A", name: "富邦特", type: "PREFERRED" },
        { symbol: "0050", name: "元大台灣50", type: "ETF" },
      ],
    });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/securities");
  });

  // 2026-10-08 起回應裡沒見過的 enum 值照樣放行（passThroughEnum，對 analysis-ts 的承諾），缺欄位才是 502。
  it("passes an unrecognized type through; a missing one is a 502", async () => {
    mockFetchOnce({ ok: true, body: { count: 1, limit: 200, offset: 0, entries: [{ symbol: "9999", companyName: "x", type: "BOND" }] } });
    await expect(fetchSecurityList()).resolves.toMatchObject({ entries: [{ symbol: "9999", type: "BOND" }] });

    mockFetchOnce({ ok: true, body: { count: 1, limit: 200, offset: 0, entries: [{ symbol: "9999", companyName: "x" }] } });
    await expect(fetchSecurityList()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("includes limit/offset in the request when given", async () => {
    mockFetchOnce({ ok: true, body: { ...RAW_BODY, limit: 5, offset: 10 } });

    await fetchSecurityList(5, 10);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/securities?limit=5&offset=10");
  });

  it("returns an empty entries array without throwing when offset is past the total count", async () => {
    mockFetchOnce({ ok: true, body: { count: 2716, limit: 5, offset: 3000, entries: [] } });

    await expect(fetchSecurityList(5, 3000)).resolves.toEqual({ count: 2716, limit: 5, offset: 3000, entries: [] });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchSecurityList()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchSecurityList()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing count/limit/offset/entries", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await expect(fetchSecurityList()).rejects.toMatchObject({ statusCode: 502 });
  });
});
