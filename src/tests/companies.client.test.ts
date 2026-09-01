import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompanies } from "@/domains/companies/companies.client.js";

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

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
  const fn = vi.fn();
  for (const response of responses) {
    fn.mockResolvedValueOnce({
      ok: response.ok,
      status: response.status ?? 200,
      json: () => Promise.resolve(response.body),
    });
  }
  globalThis.fetch = fn as unknown as typeof fetch;
}

describe("fetchCompanies", () => {
  // analysis-ts added pagination to GET /companies (2026-09-01): { count, limit, offset, entries }
  // instead of a flat array, with a 1000-entry hard cap per request.
  it("requests /companies with limit=1000/offset=0 and returns entries as-is when everything fits in one page", async () => {
    const companies = [
      { companyId: "2330", companyName: "台積電" },
      { companyId: "6117", companyName: "迎廣" },
    ];
    mockFetchSequence([{ ok: true, body: { count: 2, entries: companies } }]);

    const result = await fetchCompanies();

    expect(result).toEqual(companies);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies?limit=1000&offset=0");
  });

  // Regression coverage for the pagination migration: analysis-ts's real dataset (~2,650 companies)
  // needs 3 requests at limit=1000 — must loop until `count` entries are collected, not just take the
  // first page and silently return an incomplete list.
  it("pages through with offset until count entries are collected", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ companyId: `A${i}`, companyName: `Company A${i}` }));
    const page2 = Array.from({ length: 1000 }, (_, i) => ({ companyId: `B${i}`, companyName: `Company B${i}` }));
    const page3 = Array.from({ length: 648 }, (_, i) => ({ companyId: `C${i}`, companyName: `Company C${i}` }));
    mockFetchSequence([
      { ok: true, body: { count: 2648, entries: page1 } },
      { ok: true, body: { count: 2648, entries: page2 } },
      { ok: true, body: { count: 2648, entries: page3 } },
    ]);

    const result = await fetchCompanies();

    expect(result).toHaveLength(2648);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    const urls = vi.mocked(globalThis.fetch).mock.calls.map((call) => (call[0] as URL).toString());
    expect(urls).toEqual([
      "http://filters.test/companies?limit=1000&offset=0",
      "http://filters.test/companies?limit=1000&offset=1000",
      "http://filters.test/companies?limit=1000&offset=2000",
    ]);
  });

  it("stops looping if a page comes back empty, even if count claims more remain (avoids an infinite loop)", async () => {
    mockFetchSequence([{ ok: true, body: { count: 999, entries: [] } }]);

    const result = await fetchCompanies();

    expect(result).toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("accepts a null companyName", async () => {
    mockFetchSequence([{ ok: true, body: { count: 1, entries: [{ companyId: "9999", companyName: null }] } }]);

    const result = await fetchCompanies();

    expect(result).toEqual([{ companyId: "9999", companyName: null }]);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchCompanies()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the companies endpoint responds with a non-2xx status", async () => {
    mockFetchSequence([{ ok: false, status: 503, body: {} }]);

    await expect(fetchCompanies()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is a bare array (the old, pre-pagination shape)", async () => {
    mockFetchSequence([{ ok: true, body: [{ companyId: "2330", companyName: "台積電" }] }]);

    await expect(fetchCompanies()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when an entry is missing companyId", async () => {
    mockFetchSequence([{ ok: true, body: { count: 1, entries: [{ companyName: "台積電" }] } }]);

    await expect(fetchCompanies()).rejects.toMatchObject({ statusCode: 502 });
  });
});
