import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAttentionStocks,
  fetchDisposedStocks,
  fetchEtfRanking,
  fetchForeignHoldingRanking,
  fetchMarginShortRatioRanking,
  fetchMaterialAnnouncements,
  fetchPriceChangeRanking,
  fetchPriceLimitRange,
  fetchRevenueRanking,
  fetchVolumeTop20,
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

describe("fetchRevenueRanking", () => {
  it("requests /market/revenue-ranking with metric/order/limit and normalizes fields", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        yearMonth: "2026-07",
        metric: "yoy",
        order: "desc",
        limit: 2,
        rankings: [
          {
            rank: 1,
            symbol: "4113",
            companyName: "聯上",
            market: "TPEx",
            currentMonthRevenue: "581140",
            momChangePercent: 250.1181,
            yoyChangePercent: 1096390.566,
          },
          {
            rank: 2,
            symbol: "4168",
            companyName: "醣聯",
            market: "TPEx",
            currentMonthRevenue: "1057",
            momChangePercent: null,
            yoyChangePercent: 3544.8276,
          },
        ],
        warnings: [],
      },
    });

    const result = await fetchRevenueRanking("yoy", "desc", 2);

    expect(result).toEqual({
      yearMonth: "2026-07",
      metric: "yoy",
      order: "desc",
      limit: 2,
      rankings: [
        {
          rank: 1,
          symbol: "4113",
          name: "聯上",
          market: "TPEx",
          currentMonthRevenue: "581140",
          momChangePercent: "250.1181",
          yoyChangePercent: "1096390.566",
        },
        {
          rank: 2,
          symbol: "4168",
          name: "醣聯",
          market: "TPEx",
          currentMonthRevenue: "1057",
          momChangePercent: null,
          yoyChangePercent: "3544.8276",
        },
      ],
      warnings: [],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/market/revenue-ranking?metric=yoy&order=desc&limit=2");
  });

  it("relays analysis-ts's 400 message for an invalid metric", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      body: { message: "Invalid enum value. Expected 'yoy' | 'mom' | 'revenue', received 'bogus'" },
    });

    await expect(fetchRevenueRanking("bogus" as never, "desc", 20)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchRevenueRanking("yoy", "desc", 20)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: { yearMonth: "2026-07" } });

    await expect(fetchRevenueRanking("yoy", "desc", 20)).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchVolumeTop20", () => {
  it("requests /market/volume-top20 with no params and normalizes fields, preserving TPEx nulls", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        tradeDate: "2026-09-01",
        rankings: [
          {
            rank: 1,
            symbol: "6182",
            companyName: "合晶",
            market: "TPEx",
            volume: "72836",
            transaction: null,
            open: null,
            high: null,
            low: null,
            close: null,
            dir: null,
            change: null,
            changePercent: -4.09,
          },
        ],
      },
    });

    const result = await fetchVolumeTop20();

    expect(result).toEqual({
      tradeDate: "2026-09-01",
      rankings: [
        {
          rank: 1,
          symbol: "6182",
          name: "合晶",
          market: "TPEx",
          volume: "72836",
          transaction: null,
          open: null,
          high: null,
          low: null,
          close: null,
          dir: null,
          change: null,
          changePercent: "-4.09",
        },
      ],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/market/volume-top20");
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchVolumeTop20()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchVolumeTop20()).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchDisposedStocks", () => {
  it("requests /market/disposed-stocks with limit and preserves TPEx nulls vs. TWSE values", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        limit: 2,
        items: [
          {
            symbol: "3629",
            companyName: "地心引力",
            market: "TPEx",
            announceDate: "2026-09-01",
            announcementCount: null,
            reason: "連續3個營業日",
            reasonTimes: 3,
            reasonShort: "漲跌異常",
            dispositionPeriod: "1150902~1150908",
            dispositionStartDate: "2026-09-02",
            dispositionEndDate: "2026-09-08",
            dispositionMeasures: null,
            detail: "詳如說明",
            linkInformation: null,
            sixDayChangePercent: 42.65,
          },
          {
            symbol: "6226",
            companyName: "光鼎",
            market: "TWSE",
            announceDate: "2026-09-01",
            announcementCount: 1,
            reason: "提供公布日期近一個月之標準",
            reasonTimes: null,
            reasonShort: null,
            dispositionPeriod: "1150902~1150908",
            dispositionStartDate: "2026-09-02",
            dispositionEndDate: "2026-09-08",
            dispositionMeasures: "第一次處置",
            detail: "詳如說明",
            linkInformation: "提供處置有價證券連結資訊",
            sixDayChangePercent: null,
          },
        ],
        warnings: [],
      },
    });

    const result = await fetchDisposedStocks(2);

    expect(result.items).toEqual([
      {
        symbol: "3629",
        name: "地心引力",
        market: "TPEx",
        announceDate: "2026-09-01",
        announcementCount: null,
        reason: "連續3個營業日",
        reasonTimes: 3,
        reasonShort: "漲跌異常",
        dispositionPeriod: "1150902~1150908",
        dispositionStartDate: "2026-09-02",
        dispositionEndDate: "2026-09-08",
        dispositionMeasures: null,
        detail: "詳如說明",
        linkInformation: null,
        sixDayChangePercent: "42.65",
      },
      {
        symbol: "6226",
        name: "光鼎",
        market: "TWSE",
        announceDate: "2026-09-01",
        announcementCount: 1,
        reason: "提供公布日期近一個月之標準",
        reasonTimes: null,
        reasonShort: null,
        dispositionPeriod: "1150902~1150908",
        dispositionStartDate: "2026-09-02",
        dispositionEndDate: "2026-09-08",
        dispositionMeasures: "第一次處置",
        detail: "詳如說明",
        linkInformation: "提供處置有價證券連結資訊",
        sixDayChangePercent: null,
      },
    ]);
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/market/disposed-stocks?limit=2");
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchDisposedStocks(20)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchDisposedStocks(20)).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchAttentionStocks", () => {
  it("requests /market/attention-stocks with limit and normalizes fields, including criteriaDetails", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        limit: 1,
        items: [
          {
            symbol: "3406",
            companyName: "玉晶光",
            market: "TWSE",
            tradeDate: "2026-09-01",
            criteria: "115年8月28日至115年8月31日連續二次",
            criteriaDetails: [{ startDate: "2026-08-28", endDate: "2026-08-31", observationDays: null, times: 2 }],
            sixDayChangePercent: 41.08,
          },
        ],
        warnings: [],
      },
    });

    const result = await fetchAttentionStocks(1);

    expect(result).toEqual({
      limit: 1,
      items: [
        {
          symbol: "3406",
          name: "玉晶光",
          market: "TWSE",
          tradeDate: "2026-09-01",
          criteria: "115年8月28日至115年8月31日連續二次",
          criteriaDetails: [{ startDate: "2026-08-28", endDate: "2026-08-31", observationDays: null, times: 2 }],
          sixDayChangePercent: "41.08",
        },
      ],
      warnings: [],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/market/attention-stocks?limit=1");
  });

  // Regression: raw criteria text sometimes concatenates two clauses with no separator, so
  // criteriaDetails can have more than one entry per item.
  it("preserves multiple criteriaDetails entries when the raw text concatenates two clauses", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        limit: 1,
        items: [
          {
            symbol: "1234",
            companyName: "測試",
            market: "TWSE",
            tradeDate: "2026-09-01",
            criteria: "115年08月27日至115年09月01日連續四次115年08月20日至115年09月01日等九個營業日已有五次",
            criteriaDetails: [
              { startDate: "2026-08-27", endDate: "2026-09-01", observationDays: null, times: 4 },
              { startDate: "2026-08-20", endDate: "2026-09-01", observationDays: 9, times: 5 },
            ],
          },
        ],
        warnings: [],
      },
    });

    const result = await fetchAttentionStocks(1);

    expect(result.items[0]?.criteriaDetails).toEqual([
      { startDate: "2026-08-27", endDate: "2026-09-01", observationDays: null, times: 4 },
      { startDate: "2026-08-20", endDate: "2026-09-01", observationDays: 9, times: 5 },
    ]);
  });

  // criteriaDetails defaults to [] if analysis-ts's parse ever fails — criteria itself is unaffected.
  it("defaults criteriaDetails to an empty array when missing from the response", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        limit: 1,
        items: [{ symbol: "3406", companyName: "玉晶光", market: "TWSE", tradeDate: "2026-09-01", criteria: "無法解析的格式" }],
        warnings: [],
      },
    });

    const result = await fetchAttentionStocks(1);

    expect(result.items[0]?.criteria).toBe("無法解析的格式");
    expect(result.items[0]?.criteriaDetails).toEqual([]);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchAttentionStocks(20)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchAttentionStocks(20)).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchPriceLimitRange", () => {
  it("requests /market/price-limit-range with no params and preserves TPEx nulls vs. TWSE values", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        tradeDate: "2026-09-01",
        widest: [
          {
            rank: 1,
            symbol: "5274",
            companyName: "信驊",
            market: "TPEx",
            limitUp: 18830,
            limitDown: 15410,
            limitRange: 3420,
            openingRefPrice: null,
            previousDayPrice: null,
            allowOddLotTrade: null,
          },
          {
            rank: 2,
            symbol: "2059",
            companyName: "川湖",
            market: "TWSE",
            limitUp: 15595,
            limitDown: 12765,
            limitRange: 2830,
            openingRefPrice: 14180,
            previousDayPrice: 14180,
            allowOddLotTrade: "不可",
          },
        ],
        narrowest: [],
      },
    });

    const result = await fetchPriceLimitRange();

    expect(result).toEqual({
      tradeDate: "2026-09-01",
      widest: [
        {
          rank: 1,
          symbol: "5274",
          name: "信驊",
          market: "TPEx",
          limitUp: "18830",
          limitDown: "15410",
          limitRange: "3420",
          openingRefPrice: null,
          previousDayPrice: null,
          allowOddLotTrade: null,
        },
        {
          rank: 2,
          symbol: "2059",
          name: "川湖",
          market: "TWSE",
          limitUp: "15595",
          limitDown: "12765",
          limitRange: "2830",
          openingRefPrice: "14180",
          previousDayPrice: "14180",
          allowOddLotTrade: "不可",
        },
      ],
      narrowest: [],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/market/price-limit-range");
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchPriceLimitRange()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchPriceLimitRange()).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchPriceChangeRanking", () => {
  it("requests /market/price-change-ranking with limit and normalizes fields, keeping tradeDate per-row", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        limit: 1,
        gainers: [
          {
            rank: 1,
            symbol: "2492",
            companyName: "華新科",
            market: "TWSE",
            tradeDate: "2026-08-28",
            previousTradeDate: "2026-08-27",
            close: 313.5,
            previousClose: 285,
            changeAmount: 28.5,
            changePercent: 10,
          },
        ],
        losers: [
          {
            rank: 1,
            symbol: "5283",
            companyName: "禾聯碩",
            market: "TWSE",
            tradeDate: "2026-08-28",
            previousTradeDate: "2026-08-27",
            close: 51.9,
            previousClose: 61.1,
            changeAmount: -9.2,
            changePercent: -15.06,
          },
        ],
        warnings: [],
      },
    });

    const result = await fetchPriceChangeRanking(1);

    expect(result).toEqual({
      limit: 1,
      gainers: [
        {
          rank: 1,
          symbol: "2492",
          name: "華新科",
          market: "TWSE",
          tradeDate: "2026-08-28",
          previousTradeDate: "2026-08-27",
          close: "313.5",
          previousClose: "285",
          changeAmount: "28.5",
          changePercent: "10",
        },
      ],
      losers: [
        {
          rank: 1,
          symbol: "5283",
          name: "禾聯碩",
          market: "TWSE",
          tradeDate: "2026-08-28",
          previousTradeDate: "2026-08-27",
          close: "51.9",
          previousClose: "61.1",
          changeAmount: "-9.2",
          changePercent: "-15.06",
        },
      ],
      warnings: [],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/market/price-change-ranking?limit=1");
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchPriceChangeRanking(20)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchPriceChangeRanking(20)).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchEtfRanking", () => {
  it("requests /market/etf-ranking with metric/order/limit and normalizes fields", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        metric: "aum",
        order: "desc",
        limit: 1,
        rankings: [
          {
            rank: 1,
            symbol: "0050",
            fundName: "元大台灣卓越50基金",
            shortName: "元大台灣50",
            companyName: "元大投信",
            category: "上市ETF_國內成分證券ETF",
            value: 2283731446214,
            asOf: "2026-07",
          },
        ],
        warnings: [],
      },
    });

    const result = await fetchEtfRanking("aum", "desc", 1);

    expect(result).toEqual({
      metric: "aum",
      order: "desc",
      limit: 1,
      rankings: [
        {
          rank: 1,
          symbol: "0050",
          fundName: "元大台灣卓越50基金",
          shortName: "元大台灣50",
          issuerName: "元大投信",
          category: "上市ETF_國內成分證券ETF",
          value: "2283731446214",
          asOf: "2026-07",
        },
      ],
      warnings: [],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/market/etf-ranking?metric=aum&order=desc&limit=1");
  });

  it("relays analysis-ts's 400 message for an invalid metric", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: "Invalid enum value" } });

    await expect(fetchEtfRanking("bogus" as never, "desc", 20)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchEtfRanking("aum", "desc", 20)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchEtfRanking("aum", "desc", 20)).rejects.toMatchObject({ statusCode: 502 });
  });
});
