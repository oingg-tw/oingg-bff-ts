import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchIndustryTree } from "@/domains/industries/industries.client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FILTERS_URL = process.env.FILTERS_SERVICE_URL;
const ORIGINAL_BFF_API_KEY = process.env.BFF_API_KEY;

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://filters.test";
  process.env.BFF_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_FILTERS_URL === undefined) {
    delete process.env.FILTERS_SERVICE_URL;
  } else {
    process.env.FILTERS_SERVICE_URL = ORIGINAL_FILTERS_URL;
  }
  if (ORIGINAL_BFF_API_KEY === undefined) {
    delete process.env.BFF_API_KEY;
  } else {
    process.env.BFF_API_KEY = ORIGINAL_BFF_API_KEY;
  }
});

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  }) as unknown as typeof fetch;
}

const ROOT_RESPONSE = {
  found: true,
  code: null,
  level: null,
  name: null,
  companyCount: 999,
  children: [
    { code: "A", level: "section", name: "農、林、漁、牧業", companyCount: 4, hasChildren: true },
    { code: "O", level: "section", name: "公共行政及國防；強制性社會安全", companyCount: 0, hasChildren: true },
  ],
  companies: [],
};

const LEAF_RESPONSE = {
  found: true,
  code: "2711-00",
  level: "subclass",
  name: "電腦製造業",
  companyCount: 18,
  children: [],
  companies: [{ symbol: "2317", companyName: "鴻海" }],
};

const NOT_FOUND_RESPONSE = {
  found: false,
  code: "ZZZZ-NOPE",
  level: null,
  name: null,
  companyCount: 0,
  children: [],
  companies: [],
};

describe("fetchIndustryTree", () => {
  it("requests /industries/tree without a code param when omitted, and normalizes the root response", async () => {
    mockFetchOnce({ ok: true, body: ROOT_RESPONSE });

    const result = await fetchIndustryTree();

    expect(result).toEqual(ROOT_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/tree");
  });

  // hasChildren can be true even when companyCount is 0 — the dictionary has children even if no
  // tracked company currently falls under this node. Normalization must preserve this, not collapse it.
  it("preserves a zero companyCount alongside hasChildren: true", async () => {
    mockFetchOnce({ ok: true, body: ROOT_RESPONSE });

    const result = await fetchIndustryTree();

    const empty = result.children.find((c) => c.code === "O");
    expect(empty).toEqual({ code: "O", level: "section", name: "公共行政及國防；強制性社會安全", companyCount: 0, hasChildren: true });
  });

  it("requests /industries/tree?code= with the given code and normalizes a leaf (subclass) response", async () => {
    mockFetchOnce({ ok: true, body: LEAF_RESPONSE });

    const result = await fetchIndustryTree("2711-00");

    expect(result).toEqual(LEAF_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/tree?code=2711-00");
  });

  it("returns found:false for an unknown code, without throwing", async () => {
    mockFetchOnce({ ok: true, body: NOT_FOUND_RESPONSE });

    await expect(fetchIndustryTree("ZZZZ-NOPE")).resolves.toEqual(NOT_FOUND_RESPONSE);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchIndustryTree("C")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchIndustryTree("C")).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing a boolean "found" field', async () => {
    mockFetchOnce({ ok: true, body: { code: "C" } });

    await expect(fetchIndustryTree("C")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a child has an unrecognized level", async () => {
    mockFetchOnce({
      ok: true,
      body: { ...ROOT_RESPONSE, children: [{ code: "X", level: "not-a-real-level", name: "x", companyCount: 1, hasChildren: false }] },
    });

    await expect(fetchIndustryTree()).rejects.toMatchObject({ statusCode: 502 });
  });
});
