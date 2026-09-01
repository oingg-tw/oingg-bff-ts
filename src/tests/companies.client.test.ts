import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompanies } from "../domains/companies/companies.client.js";

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

describe("fetchCompanies", () => {
  it("requests /companies on the configured filters service and returns the flat array as-is", async () => {
    const companies = [
      { companyId: "2330", companyName: "台積電" },
      { companyId: "6117", companyName: "迎廣" },
    ];
    mockFetchOnce({ ok: true, body: companies });

    const result = await fetchCompanies();

    expect(result).toEqual(companies);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies");
  });

  it("accepts a null companyName", async () => {
    mockFetchOnce({ ok: true, body: [{ companyId: "9999", companyName: null }] });

    const result = await fetchCompanies();

    expect(result).toEqual([{ companyId: "9999", companyName: null }]);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchCompanies()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the companies endpoint responds with a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 503, body: [] });

    await expect(fetchCompanies()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response isn't a flat array (e.g. wrapped in an envelope)", async () => {
    mockFetchOnce({ ok: true, body: { companies: [] } });

    await expect(fetchCompanies()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when an entry is missing companyId", async () => {
    mockFetchOnce({ ok: true, body: [{ companyName: "台積電" }] });

    await expect(fetchCompanies()).rejects.toMatchObject({ statusCode: 502 });
  });
});
