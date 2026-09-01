import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchForeignHoldingRanking, fetchMarginShortRatioRanking } from "@/domains/market/marketRankings.client.js";

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

describe("fetchForeignHoldingRanking", () => {
  it("requests /market/foreign-holding-ranking with topPercent and normalizes numeric fields to strings", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        tradeDate: "2026-08-30",
        previousTradeDate: "2026-08-28",
        topPercent: 10,
        eligibleCompanyCount: 1200,
        increases: [
          {
            symbol: "2330",
            sharesHeldPercent: 78.5,
            previousSharesHeldPercent: 78.1,
            changePercentagePoints: 0.4,
            sharesHeld: "20500000000",
          },
        ],
        decreases: [],
        warnings: [],
      },
    });

    const result = await fetchForeignHoldingRanking(10);

    expect(result).toEqual({
      tradeDate: "2026-08-30",
      previousTradeDate: "2026-08-28",
      topPercent: 10,
      eligibleCompanyCount: 1200,
      increases: [
        {
          symbol: "2330",
          sharesHeldPercent: "78.5",
          previousSharesHeldPercent: "78.1",
          changePercentagePoints: "0.4",
          sharesHeld: "20500000000",
        },
      ],
      decreases: [],
      warnings: [],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/market/foreign-holding-ranking?topPercent=10");
  });

  // Regression: verified live — when analysis-ts doesn't have two comparable trading days yet, tradeDate/
  // previousTradeDate come back as empty strings, not null. Normalized to null, a clearer "no data" signal.
  it("normalizes an empty-string tradeDate/previousTradeDate to null (data not ready yet)", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        tradeDate: "",
        previousTradeDate: "",
        topPercent: 10,
        eligibleCompanyCount: 0,
        increases: [],
        decreases: [],
        warnings: ["foreign_holding 資料不足兩個交易日，無法比較變動。"],
      },
    });

    const result = await fetchForeignHoldingRanking(10);

    expect(result.tradeDate).toBeNull();
    expect(result.previousTradeDate).toBeNull();
    expect(result.warnings).toEqual(["foreign_holding 資料不足兩個交易日，無法比較變動。"]);
  });

  it("relays analysis-ts's 400 message for an out-of-range topPercent", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: "topPercent must be between 1 and 50" } });

    await expect(fetchForeignHoldingRanking(0)).rejects.toMatchObject({
      statusCode: 400,
      message: "topPercent must be between 1 and 50",
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchForeignHoldingRanking(10)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: { topPercent: 10 } });

    await expect(fetchForeignHoldingRanking(10)).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchMarginShortRatioRanking", () => {
  it("requests /market/margin-short-ratio-ranking with limit and normalizes numeric fields to strings", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        tradeDate: "2026-08-30",
        limit: 5,
        rankings: [
          { rank: 1, symbol: "3045", shortToMarginRatioPct: 44.35, marginTodayBalance: "717", shortTodayBalance: "318" },
        ],
        warnings: [],
      },
    });

    const result = await fetchMarginShortRatioRanking(5);

    expect(result).toEqual({
      tradeDate: "2026-08-30",
      limit: 5,
      rankings: [
        {
          rank: 1,
          symbol: "3045",
          name: null,
          shortToMarginRatioPct: "44.35",
          marginTodayBalance: "717",
          shortTodayBalance: "318",
        },
      ],
      warnings: [],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/market/margin-short-ratio-ranking?limit=5");
  });

  it("relays analysis-ts's 400 message for an out-of-range limit", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: "limit must be between 1 and 100" } });

    await expect(fetchMarginShortRatioRanking(500)).rejects.toMatchObject({
      statusCode: 400,
      message: "limit must be between 1 and 100",
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchMarginShortRatioRanking(20)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: { tradeDate: "2026-08-30" } });

    await expect(fetchMarginShortRatioRanking(20)).rejects.toMatchObject({ statusCode: 502 });
  });
});
