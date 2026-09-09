import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchExDividendCalendar } from "@/domainBff/stock/exDividendCalendar.client.js";

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

// Real entries given directly by analysis-ts (2026-09-10).
const RAW_BODY = {
  entries: [
    {
      symbol: "00939",
      companyName: null,
      exDate: "2026-09-01",
      exType: "息",
      stockDividendRatio: null,
      subscriptionRatio: null,
      subscriptionPricePerShare: null,
      cashDividend: 0.125,
      sharesOffered: null,
      sharesEmpOwner: null,
      sharesholderOwner: null,
      stockHoldingRatio: null,
    },
    {
      symbol: "1732",
      companyName: "毛寶",
      exDate: "2026-09-01",
      exType: "息",
      stockDividendRatio: null,
      subscriptionRatio: null,
      subscriptionPricePerShare: null,
      cashDividend: 0.6,
      sharesOffered: null,
      sharesEmpOwner: null,
      sharesholderOwner: null,
      stockHoldingRatio: null,
    },
  ],
};

describe("fetchExDividendCalendar", () => {
  it("requests /stocks/ex-dividend-calendar with the given month and normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchExDividendCalendar("2026-09");

    expect(result).toEqual(RAW_BODY);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/stocks/ex-dividend-calendar?month=2026-09");
  });

  // ETFs aren't in analysis-ts's company reference table — companyName stays null, not coerced to "".
  it("keeps companyName null for a symbol with no company reference (e.g. an ETF)", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchExDividendCalendar("2026-09");

    expect(result.entries[0]?.symbol).toBe("00939");
    expect(result.entries[0]?.companyName).toBeNull();
  });

  it("returns an empty entries array for a month with no data, without throwing", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await expect(fetchExDividendCalendar("2099-01")).resolves.toEqual({ entries: [] });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchExDividendCalendar("2026-09")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchExDividendCalendar("2026-09")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing an entries array", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchExDividendCalendar("2026-09")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when an entry has an unrecognized exType", async () => {
    mockFetchOnce({ ok: true, body: { entries: [{ ...RAW_BODY.entries[0], exType: "not-a-real-type" }] } });

    await expect(fetchExDividendCalendar("2026-09")).rejects.toMatchObject({ statusCode: 502 });
  });
});
