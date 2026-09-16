import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBeta } from "@/domainBff/stock/beta.client.js";

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

// Real shape given directly by analysis-ts: fixed 4 windows, 1Y_1D/2Y_1W/3Y_1W/5Y_1M order
// (3Y_1W added 2026-09-16, caught live when it started 502ing bff-ts's strict timeframe validation).
const RAW_BODY = {
  symbol: "2330",
  metricCode: "beta",
  windows: [
    { timeframe: "1Y_1D", value: 1.0839, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
    { timeframe: "2Y_1W", value: 1.0953, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
    { timeframe: "3Y_1W", value: 1.2036, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
    { timeframe: "5Y_1M", value: 1.2215, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
  ],
};

describe("fetchBeta", () => {
  it("requests /companies/beta?symbol= and normalizes all 4 windows", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchBeta("2330");

    expect(result).toEqual({
      symbol: "2330",
      windows: [
        { timeframe: "1Y_1D", value: 1.0839, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
        { timeframe: "2Y_1W", value: 1.0953, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
        { timeframe: "3Y_1W", value: 1.2036, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
        { timeframe: "5Y_1M", value: 1.2215, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
      ],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/companies/beta?symbol=2330");
  });

  // Confirmed live: an unknown/not-yet-backfilled symbol is still a 200, every window entirely null.
  it("returns all-null windows without throwing for an unknown symbol", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "NOPE9999",
        metricCode: "beta",
        windows: [
          { timeframe: "1Y_1D", value: null, nullReason: null, tradeDate: null, knowledgeDate: null, knowledgeDateIsFallback: null },
          { timeframe: "2Y_1W", value: null, nullReason: null, tradeDate: null, knowledgeDate: null, knowledgeDateIsFallback: null },
          { timeframe: "3Y_1W", value: null, nullReason: null, tradeDate: null, knowledgeDate: null, knowledgeDateIsFallback: null },
          { timeframe: "5Y_1M", value: null, nullReason: null, tradeDate: null, knowledgeDate: null, knowledgeDateIsFallback: null },
        ],
      },
    });

    const result = await fetchBeta("NOPE9999");

    expect(result.windows.every((w) => w.value === null && w.tradeDate === null)).toBe(true);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchBeta("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchBeta("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing symbol/windows", async () => {
    mockFetchOnce({ ok: true, body: { metricCode: "beta" } });

    await expect(fetchBeta("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a window has an unrecognized timeframe", async () => {
    mockFetchOnce({
      ok: true,
      body: { symbol: "2330", windows: [{ timeframe: "3Y_1D", value: 1, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false }] },
    });

    await expect(fetchBeta("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});
