import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDailyPriceHistory } from "@/domainBff/stock/dailyPriceHistory.client.js";

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

// Real entries given directly by analysis-ts (2026-09-10) — note oldest-to-newest ordering, the opposite
// of foreign-shareholding-history despite sharing the same /stocks/:symbol/... path convention.
const RAW_BODY = {
  symbol: "2330",
  entries: [
    { tradeDate: "2026-09-07", open: 2435, high: 2460, low: 2430, close: 2460, volume: 26898329 },
    { tradeDate: "2026-09-08", open: 2465, high: 2505, low: 2460, close: 2470, volume: 28931697 },
  ],
};

describe("fetchDailyPriceHistory", () => {
  it("requests analysis-ts's own /stocks/:symbol/daily-price-history path and normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchDailyPriceHistory("2330");

    expect(result).toEqual(RAW_BODY);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/stocks/2330/daily-price-history");
  });

  it("includes limit in the request when given", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    await fetchDailyPriceHistory("2330", 500);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/stocks/2330/daily-price-history?limit=500");
  });

  it("returns an empty entries array for an unknown symbol, without throwing", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "NOPE", entries: [] } });

    await expect(fetchDailyPriceHistory("NOPE")).resolves.toEqual({ symbol: "NOPE", entries: [] });
  });

  // analysis-ts validates limit bounds (1-2000) itself and returns a 400 with a clear message — relayed
  // as-is, same convention as the other history endpoints in this domain.
  it("relays analysis-ts's 400 message for an out-of-range limit", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: "Too big: expected number to be <=2000" } });

    await expect(fetchDailyPriceHistory("2330", 99999)).rejects.toMatchObject({
      statusCode: 400,
      message: "Too big: expected number to be <=2000",
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchDailyPriceHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx, non-400 status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchDailyPriceHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing an entries array", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330" } });

    await expect(fetchDailyPriceHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});
