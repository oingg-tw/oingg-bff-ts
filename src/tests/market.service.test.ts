import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/market/marketRankings.client.js", () => ({
  fetchForeignHoldingRanking: vi.fn(),
  fetchMarginShortRatioRanking: vi.fn(),
  fetchMaterialAnnouncements: vi.fn(),
  fetchRevenueRanking: vi.fn(),
  fetchVolumeTop20: vi.fn(),
  fetchDisposedStocks: vi.fn(),
  fetchAttentionStocks: vi.fn(),
  fetchPriceLimitRange: vi.fn(),
  fetchPriceChangeRanking: vi.fn(),
  fetchEtfRanking: vi.fn(),
}));

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
import {
  getAttentionStocks,
  getDisposedStocks,
  getEtfRanking,
  getForeignHoldingRanking,
  getMarginShortRatioRanking,
  getMaterialAnnouncements,
  getPriceChangeRanking,
  getPriceLimitRange,
  getRevenueRanking,
  getVolumeTop20,
} from "@/domains/market/market.service.js";

beforeEach(() => {
  vi.mocked(fetchForeignHoldingRanking).mockReset();
  vi.mocked(fetchMarginShortRatioRanking).mockReset();
  vi.mocked(fetchMaterialAnnouncements).mockReset();
  vi.mocked(fetchRevenueRanking).mockReset();
  vi.mocked(fetchVolumeTop20).mockReset();
  vi.mocked(fetchPriceChangeRanking).mockReset();
  vi.mocked(fetchEtfRanking).mockReset();
  vi.mocked(fetchDisposedStocks).mockReset();
  vi.mocked(fetchAttentionStocks).mockReset();
  vi.mocked(fetchPriceLimitRange).mockReset();
});

describe("getForeignHoldingRanking", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(fetchForeignHoldingRanking).mockResolvedValue({
      tradeDate: null,
      previousTradeDate: null,
      limit: 10,
      eligibleCompanyCount: 0,
      increases: [],
      decreases: [],
      warnings: [],
    });

    await getForeignHoldingRanking(10);

    expect(fetchForeignHoldingRanking).toHaveBeenCalledWith(10);
  });

  // Bounds match analysis-ts's own validation (verified live: 1-20). This replaced the endpoint's
  // original 1-50 topPercent bounds as of 2026-09-01 — see marketRankings.client.ts.
  it.each([0, -1, 21, 1.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getForeignHoldingRanking(value)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchForeignHoldingRanking).not.toHaveBeenCalled();
  });

  it.each([1, 20])("accepts the boundary values (%s)", async (value) => {
    vi.mocked(fetchForeignHoldingRanking).mockResolvedValue({
      tradeDate: null,
      previousTradeDate: null,
      limit: value,
      eligibleCompanyCount: 0,
      increases: [],
      decreases: [],
      warnings: [],
    });

    await expect(getForeignHoldingRanking(value)).resolves.toBeDefined();
  });
});

describe("getMarginShortRatioRanking", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(fetchMarginShortRatioRanking).mockResolvedValue({
      tradeDate: "2026-08-30",
      limit: 20,
      rankings: [],
      warnings: [],
    });

    await getMarginShortRatioRanking(20);

    expect(fetchMarginShortRatioRanking).toHaveBeenCalledWith(20);
  });

  // Bounds match analysis-ts's own validation (verified live via binary search: 1-100).
  it.each([0, -1, 101, 500, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getMarginShortRatioRanking(value)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMarginShortRatioRanking).not.toHaveBeenCalled();
  });

  it.each([1, 100])("accepts the boundary values (%s)", async (value) => {
    vi.mocked(fetchMarginShortRatioRanking).mockResolvedValue({
      tradeDate: "2026-08-30",
      limit: value,
      rankings: [],
      warnings: [],
    });

    await expect(getMarginShortRatioRanking(value)).resolves.toBeDefined();
  });

  // analysis-ts attaches companyName directly on each row as of 2026-09-01 (see marketRankings.client.ts's
  // normalizeMarginShortRatioEntry) — passed straight through, no local merge step.
  it("passes each row's company name through directly from fetchMarginShortRatioRanking", async () => {
    vi.mocked(fetchMarginShortRatioRanking).mockResolvedValue({
      tradeDate: "2026-08-30",
      limit: 2,
      rankings: [
        { rank: 1, symbol: "3045", name: "台灣光罩", shortToMarginRatioPct: "44.35", marginTodayBalance: "717", shortTodayBalance: "318" },
        { rank: 2, symbol: "9999", name: null, shortToMarginRatioPct: "36.01", marginTodayBalance: "4476", shortTodayBalance: "1612" },
      ],
      warnings: [],
    });

    const result = await getMarginShortRatioRanking(2);

    expect(result.rankings).toEqual([
      { rank: 1, symbol: "3045", name: "台灣光罩", shortToMarginRatioPct: "44.35", marginTodayBalance: "717", shortTodayBalance: "318" },
      { rank: 2, symbol: "9999", name: null, shortToMarginRatioPct: "36.01", marginTodayBalance: "4476", shortTodayBalance: "1612" },
    ]);
  });
});

describe("getMaterialAnnouncements", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(fetchMaterialAnnouncements).mockResolvedValue({ limit: 20, items: [], warnings: [] });

    await getMaterialAnnouncements(20);

    expect(fetchMaterialAnnouncements).toHaveBeenCalledWith(20);
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getMaterialAnnouncements(value)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMaterialAnnouncements).not.toHaveBeenCalled();
  });

  it.each([1, 50])("accepts the boundary values (%s)", async (value) => {
    vi.mocked(fetchMaterialAnnouncements).mockResolvedValue({ limit: value, items: [], warnings: [] });

    await expect(getMaterialAnnouncements(value)).resolves.toBeDefined();
  });

  it("passes each item's company name through directly from fetchMaterialAnnouncements", async () => {
    vi.mocked(fetchMaterialAnnouncements).mockResolvedValue({
      limit: 1,
      items: [
        {
          symbol: "2072",
          name: "世紀風電",
          announcementDate: "2026-08-28",
          announcementTime: "70003",
          reportDate: "2026-08-29",
          subject: "公告更名",
          clause: "第51款",
          factDate: "2026-08-24",
          description: "詳如說明",
        },
      ],
      warnings: [],
    });

    const result = await getMaterialAnnouncements(1);

    expect(result.items[0]?.name).toBe("世紀風電");
  });
});

describe("getRevenueRanking", () => {
  it("delegates valid metric/order/limit straight through", async () => {
    vi.mocked(fetchRevenueRanking).mockResolvedValue({
      yearMonth: "2026-07",
      metric: "yoy",
      order: "desc",
      limit: 20,
      rankings: [],
      warnings: [],
    });

    await getRevenueRanking("yoy", "desc", 20);

    expect(fetchRevenueRanking).toHaveBeenCalledWith("yoy", "desc", 20);
  });

  it.each(["bogus", "", "YOY"])("rejects an invalid metric (%s) without calling analysis-ts", async (metric) => {
    await expect(getRevenueRanking(metric, "desc", 20)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchRevenueRanking).not.toHaveBeenCalled();
  });

  it.each(["bogus", "", "ASC"])("rejects an invalid order (%s) without calling analysis-ts", async (order) => {
    await expect(getRevenueRanking("yoy", order, 20)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchRevenueRanking).not.toHaveBeenCalled();
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getRevenueRanking("yoy", "desc", value)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchRevenueRanking).not.toHaveBeenCalled();
  });
});

describe("getVolumeTop20", () => {
  it("delegates straight through with no params", async () => {
    vi.mocked(fetchVolumeTop20).mockResolvedValue({ tradeDate: "2026-09-01", rankings: [] });

    await getVolumeTop20();

    expect(fetchVolumeTop20).toHaveBeenCalledWith();
  });
});

describe("getDisposedStocks", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(fetchDisposedStocks).mockResolvedValue({ limit: 20, items: [], warnings: [] });

    await getDisposedStocks(20);

    expect(fetchDisposedStocks).toHaveBeenCalledWith(20);
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getDisposedStocks(value)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchDisposedStocks).not.toHaveBeenCalled();
  });
});

describe("getAttentionStocks", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(fetchAttentionStocks).mockResolvedValue({ limit: 20, items: [], warnings: [] });

    await getAttentionStocks(20);

    expect(fetchAttentionStocks).toHaveBeenCalledWith(20);
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getAttentionStocks(value)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchAttentionStocks).not.toHaveBeenCalled();
  });
});

describe("getPriceLimitRange", () => {
  it("delegates straight through with no params", async () => {
    vi.mocked(fetchPriceLimitRange).mockResolvedValue({ tradeDate: "2026-09-01", widest: [], narrowest: [] });

    await getPriceLimitRange();

    expect(fetchPriceLimitRange).toHaveBeenCalledWith();
  });
});

describe("getPriceChangeRanking", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(fetchPriceChangeRanking).mockResolvedValue({ limit: 20, gainers: [], losers: [], warnings: [] });

    await getPriceChangeRanking(20);

    expect(fetchPriceChangeRanking).toHaveBeenCalledWith(20);
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getPriceChangeRanking(value)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchPriceChangeRanking).not.toHaveBeenCalled();
  });

  it.each([1, 50])("accepts the boundary values (%s)", async (value) => {
    vi.mocked(fetchPriceChangeRanking).mockResolvedValue({ limit: value, gainers: [], losers: [], warnings: [] });

    await expect(getPriceChangeRanking(value)).resolves.toBeDefined();
  });
});

describe("getEtfRanking", () => {
  it("delegates valid metric/order/limit straight through", async () => {
    vi.mocked(fetchEtfRanking).mockResolvedValue({ metric: "aum", order: "desc", limit: 20, rankings: [], warnings: [] });

    await getEtfRanking("aum", "desc", 20);

    expect(fetchEtfRanking).toHaveBeenCalledWith("aum", "desc", 20);
  });

  it.each(["bogus", "", "AUM"])("rejects an invalid metric (%s) without calling analysis-ts", async (metric) => {
    await expect(getEtfRanking(metric, "desc", 20)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchEtfRanking).not.toHaveBeenCalled();
  });

  it.each(["bogus", "", "DESC"])("rejects an invalid order (%s) without calling analysis-ts", async (order) => {
    await expect(getEtfRanking("aum", order, 20)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchEtfRanking).not.toHaveBeenCalled();
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getEtfRanking("aum", "desc", value)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchEtfRanking).not.toHaveBeenCalled();
  });

  // All 13 metrics are valid, not just the ones exercised elsewhere in this file.
  it.each([
    "aum",
    "holders",
    "netFlow",
    "dcaAmount",
    "return3m",
    "return6m",
    "return1y",
    "return2y",
    "return3y",
    "return5y",
    "returnYtd",
    "return10y",
    "expenseRatio",
  ])("accepts metric %s", async (metric) => {
    vi.mocked(fetchEtfRanking).mockResolvedValue({ metric: metric as never, order: "desc", limit: 20, rankings: [], warnings: [] });

    await expect(getEtfRanking(metric, "desc", 20)).resolves.toBeDefined();
  });
});
