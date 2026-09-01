import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchForeignHoldingRanking,
  fetchMarginShortRatioRanking,
  fetchMaterialAnnouncements,
} from "@/domains/market/marketRankings.client.js";

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
  it("requests /market/foreign-holding-ranking with limit and normalizes numeric fields to strings", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        tradeDate: "2026-08-30",
        previousTradeDate: "2026-08-28",
        limit: 10,
        eligibleCompanyCount: 1200,
        increases: [
          {
            symbol: "2330",
            companyName: "台積電",
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
      limit: 10,
      eligibleCompanyCount: 1200,
      increases: [
        {
          symbol: "2330",
          name: "台積電",
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
    expect(url.toString()).toBe("http://filters.test/market/foreign-holding-ranking?limit=10");
  });

  // Regression: verified live — when analysis-ts doesn't have two comparable trading days yet, tradeDate/
  // previousTradeDate come back as empty strings, not null. Normalized to null, a clearer "no data" signal.
  it("normalizes an empty-string tradeDate/previousTradeDate to null (data not ready yet)", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        tradeDate: "",
        previousTradeDate: "",
        limit: 10,
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

  it("relays analysis-ts's 400 message for an out-of-range limit", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: "limit must be between 1 and 20" } });

    await expect(fetchForeignHoldingRanking(0)).rejects.toMatchObject({
      statusCode: 400,
      message: "limit must be between 1 and 20",
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchForeignHoldingRanking(10)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: { limit: 10 } });

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
          {
            rank: 1,
            symbol: "3045",
            companyName: "台灣光罩",
            shortToMarginRatioPct: 44.35,
            marginTodayBalance: "717",
            shortTodayBalance: "318",
          },
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
          name: "台灣光罩",
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

describe("fetchMaterialAnnouncements", () => {
  it("requests /market/material-announcements with limit and normalizes fields to strings", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        limit: 1,
        items: [
          {
            symbol: "2072",
            companyName: "世紀風電",
            announcementDate: "2026-08-28",
            announcementTime: "70003",
            reportDate: "2026-08-29",
            subject: "公告本公司名稱由「世紀離岸風電設備股份有限公司」更名為「世紀能源設備股份有限公司」",
            clause: "第51款",
            factDate: "2026-08-24",
            description: "1.事實發生日：民國115年08月24日",
          },
        ],
        warnings: [],
      },
    });

    const result = await fetchMaterialAnnouncements(1);

    expect(result).toEqual({
      limit: 1,
      items: [
        {
          symbol: "2072",
          name: "世紀風電",
          announcementDate: "2026-08-28",
          announcementTime: "70003",
          reportDate: "2026-08-29",
          subject: "公告本公司名稱由「世紀離岸風電設備股份有限公司」更名為「世紀能源設備股份有限公司」",
          clause: "第51款",
          factDate: "2026-08-24",
          description: "1.事實發生日：民國115年08月24日",
        },
      ],
      warnings: [],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/market/material-announcements?limit=1");
  });

  it("relays analysis-ts's 400 message for an out-of-range limit", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: "limit must be between 1 and 50" } });

    await expect(fetchMaterialAnnouncements(0)).rejects.toMatchObject({
      statusCode: 400,
      message: "limit must be between 1 and 50",
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchMaterialAnnouncements(20)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchMaterialAnnouncements(20)).rejects.toMatchObject({ statusCode: 502 });
  });
});
