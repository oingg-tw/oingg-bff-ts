import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStockPrices, fetchStockQuote } from "@/domains/stock/stockQuote.client.js";

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

describe("fetchStockQuote", () => {
  it("requests /stocks/:symbol/quote and returns the parsed quote", async () => {
    const quote = {
      symbol: "2330",
      price: { tradeDate: "2026-09-01", close: "1090" },
      valuation: { tradeDate: "2026-09-01", peRatio: "28.05", pbRatio: "9.76", dividendYield: "0.91" },
    };
    mockFetchOnce({ ok: true, body: quote });

    const result = await fetchStockQuote("2330");

    expect(result).toEqual(quote);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/stocks/2330/quote");
  });

  it("returns null on a 404 (unknown symbol in either market) instead of throwing", async () => {
    mockFetchOnce({ ok: false, status: 404, body: {} });

    await expect(fetchStockQuote("nope")).resolves.toBeNull();
  });

  // Regression: verified live against analysis-ts's real endpoint — it sends ratio/percentage fields as
  // JSON numbers (close: 2420, peRatio: 28.05), their genuine existing convention for Decimal-backed
  // fields (confirmed with them directly), not something new to this endpoint. Normalize to strings
  // anyway so bff-ts's own outward API stays consistent with its screener values — which are strings
  // only because node-postgres's default NUMERIC serialization does that, not because of any shared
  // convention with analysis-ts's API.
  it("normalizes numeric price/valuation fields to strings for bff-ts's own outward-consistency choice", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "2330",
        price: { tradeDate: "2026-08-28", close: 2420 },
        valuation: { tradeDate: "2026-08-28", peRatio: 28.05, pbRatio: 9.76, dividendYield: 0.91 },
      },
    });

    const result = await fetchStockQuote("2330");

    expect(result).toEqual({
      symbol: "2330",
      price: { tradeDate: "2026-08-28", close: "2420" },
      valuation: { tradeDate: "2026-08-28", peRatio: "28.05", pbRatio: "9.76", dividendYield: "0.91" },
    });
  });

  it("keeps a null close/valuation field as null rather than stringifying it", async () => {
    mockFetchOnce({
      ok: true,
      body: { symbol: "2330", price: { tradeDate: "2026-08-28", close: null }, valuation: null },
    });

    const result = await fetchStockQuote("2330");

    expect(result).toEqual({
      symbol: "2330",
      price: { tradeDate: "2026-08-28", close: null },
      valuation: null,
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchStockQuote("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-404 non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchStockQuote("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing required fields", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330" } });

    await expect(fetchStockQuote("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchStockPrices", () => {
  it("returns an empty map without calling fetch when given no symbols", async () => {
    const result = await fetchStockPrices([]);

    expect(result).toEqual(new Map());
    expect(globalThis.fetch).toBe(ORIGINAL_FETCH);
  });

  it("requests /stocks/prices with a comma-joined symbols param and returns a Map", async () => {
    mockFetchOnce({
      ok: true,
      body: { prices: { "2330": { close: "1090", tradeDate: "2026-09-01" } } },
    });

    const result = await fetchStockPrices(["2330", "1240"]);

    expect(result).toEqual(new Map([["2330", { close: "1090", tradeDate: "2026-09-01" }]]));
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/stocks/prices?symbols=2330%2C1240");
  });

  // Same normalization as fetchStockQuote — see that test's comment for why.
  it("normalizes a numeric close field to a string", async () => {
    mockFetchOnce({ ok: true, body: { prices: { "2330": { close: 2420, tradeDate: "2026-08-28" } } } });

    const result = await fetchStockPrices(["2330"]);

    expect(result).toEqual(new Map([["2330", { close: "2420", tradeDate: "2026-08-28" }]]));
  });

  // Regression-shaped: analysis-ts confirmed a symbol with no data is simply absent from `prices` — not
  // mapped to null, not silently dropped as part of some truncation. "present = has data" must hold.
  it("a symbol absent from the response's prices object is absent from the returned Map too", async () => {
    mockFetchOnce({ ok: true, body: { prices: {} } });

    const result = await fetchStockPrices(["2330"]);

    expect(result.has("2330")).toBe(false);
  });

  it("throws a 500 AppError locally (never calls fetch) when asked for more than 100 symbols", async () => {
    const symbols = Array.from({ length: 101 }, (_, i) => String(i));

    await expect(fetchStockPrices(symbols)).rejects.toMatchObject({ statusCode: 500 });
    expect(globalThis.fetch).toBe(ORIGINAL_FETCH);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchStockPrices(["2330"])).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the prices endpoint responds with a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 400, body: {} });

    await expect(fetchStockPrices(["2330"])).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response has no "prices" object', async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchStockPrices(["2330"])).rejects.toMatchObject({ statusCode: 502 });
  });
});
