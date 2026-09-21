import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCbcPolicyRate } from "@/domainBff/macro/macro.client.js";

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

// Real shape given directly by analysis-ts (2026-09-21): rates are JSON numbers (percent, 2 = 2%),
// changeBp is basis points and null only on the very first row of the full history.
const RAW_BODY = {
  entries: [
    { effectiveDate: "1989-04-01", discountRate: 5.5, collateralAccommodationRate: 6.5, unsecuredAccommodationRate: 10, changeBp: null },
    { effectiveDate: "2022-03-18", discountRate: 1.375, collateralAccommodationRate: 1.75, unsecuredAccommodationRate: 3.625, changeBp: 25 },
    { effectiveDate: "2022-06-17", discountRate: 1.5, collateralAccommodationRate: 1.875, unsecuredAccommodationRate: 3.75, changeBp: 12.5 },
  ],
};

describe("fetchCbcPolicyRate", () => {
  it("requests /macro/cbc-policy-rate with no query params by default and passes numbers through unchanged", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchCbcPolicyRate();

    expect(result).toEqual(RAW_BODY);
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/macro/cbc-policy-rate");
  });

  it("forwards from when given", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await fetchCbcPolicyRate("2020-01-01");

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/macro/cbc-policy-rate?from=2020-01-01");
  });

  // The first row of the full history has nothing earlier to diff against — must stay null, never 0.
  it("keeps changeBp null on the first historical row rather than coercing to 0", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchCbcPolicyRate();

    expect(result.entries[0]?.changeBp).toBeNull();
    expect(result.entries[1]?.changeBp).toBe(25);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchCbcPolicyRate()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchCbcPolicyRate()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing an "entries" array', async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchCbcPolicyRate()).rejects.toMatchObject({ statusCode: 502 });
  });
});
