import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchExDividendNotices } from "@/domains/stock/exDividendNotices.client.js";

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

const CASH_ONLY_ENTRY = {
  exDate: "2026-09-07",
  exType: "息",
  stockDividendRatio: null,
  subscriptionRatio: null,
  subscriptionPricePerShare: null,
  cashDividend: 0.2,
  sharesOffered: null,
  sharesEmpOwner: null,
  sharesholderOwner: null,
  stockHoldingRatio: null,
};

const SUBSCRIPTION_RIGHTS_ENTRY = {
  exDate: "2026-09-07",
  exType: "權",
  stockDividendRatio: null,
  subscriptionRatio: 0.13425227,
  subscriptionPricePerShare: 195,
  cashDividend: 0,
  sharesOffered: 680000,
  sharesEmpOwner: 680000,
  sharesholderOwner: 5440000,
  stockHoldingRatio: 107.40181948,
};

describe("fetchExDividendNotices", () => {
  it("requests /stocks/ex-dividend-notices?symbols= with comma-joined symbols and normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: { notices: { "2330": [CASH_ONLY_ENTRY] } } });

    const result = await fetchExDividendNotices(["2330", "00939"]);

    expect(result).toEqual(new Map([["2330", [CASH_ONLY_ENTRY]]]));
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/stocks/ex-dividend-notices?symbols=2330%2C00939");
  });

  it("returns an empty map without calling fetch for an empty symbols array", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const result = await fetchExDividendNotices([]);

    expect(result.size).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("omits a symbol entirely from the map when analysis-ts has no upcoming notice for it", async () => {
    mockFetchOnce({ ok: true, body: { notices: { "2330": [CASH_ONLY_ENTRY] } } });

    const result = await fetchExDividendNotices(["2330", "1240"]);

    expect(result.has("1240")).toBe(false);
  });

  // exType "權" has two mutually-exclusive field groups — stock-dividend vs. cash-increase subscription.
  it("normalizes a cash-increase subscription (權) entry with its own field group", async () => {
    mockFetchOnce({ ok: true, body: { notices: { "2330": [SUBSCRIPTION_RIGHTS_ENTRY] } } });

    const result = await fetchExDividendNotices(["2330"]);

    expect(result.get("2330")?.[0]).toEqual(SUBSCRIPTION_RIGHTS_ENTRY);
  });

  it("throws a 500 AppError when more than 100 symbols are requested at once", async () => {
    const symbols = Array.from({ length: 101 }, (_, i) => String(i));

    await expect(fetchExDividendNotices(symbols)).rejects.toMatchObject({ statusCode: 500 });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchExDividendNotices(["2330"])).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchExDividendNotices(["2330"])).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing a "notices" object', async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchExDividendNotices(["2330"])).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when an entry has an unrecognized exType", async () => {
    mockFetchOnce({ ok: true, body: { notices: { "2330": [{ ...CASH_ONLY_ENTRY, exType: "unknown" }] } } });

    await expect(fetchExDividendNotices(["2330"])).rejects.toMatchObject({ statusCode: 502 });
  });
});
