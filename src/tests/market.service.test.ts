import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeMarketGateway } from "@/tests/fakes/analysisGateways.js";
import {
  getAttentionStocks,
  getDisposedStocks,
  getEtfRanking,
  getMarginShortRatioRanking,
  getMaterialAnnouncements,
  getPriceChangeRanking,
  getPriceLimitRange,
  getRevenueRanking,
  getTaiexDailyPrice,
  getVolumeTop20,
} from "@/application/proxy/market/market.service.js";

/**
 * A fake port instead of `vi.mock` on the client module: these tests are about this service's own
 * limit/metric/order validation, and the port is the only thing they need to observe ("did an invalid
 * input reach analysis-ts at all?"). Typed as MarketGatewayPort, so adding a method to the port breaks
 * this file at compile time rather than leaving a stale mock behind.
 */
let marketGateway = fakeMarketGateway();
let deps = { marketGateway };

beforeEach(() => {
  marketGateway = fakeMarketGateway();
  deps = { marketGateway };
});

describe("getMarginShortRatioRanking", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(marketGateway.getMarginShortRatioRanking).mockResolvedValue({
      tradeDate: "2026-08-30",
      limit: 20,
      rankings: [],
      warnings: [],
    });

    await getMarginShortRatioRanking(20, deps);

    expect(marketGateway.getMarginShortRatioRanking).toHaveBeenCalledWith(20);
  });

  // Bounds match analysis-ts's own validation (verified live via binary search: 1-100).
  it.each([0, -1, 101, 500, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getMarginShortRatioRanking(value, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getMarginShortRatioRanking).not.toHaveBeenCalled();
  });

  it.each([1, 100])("accepts the boundary values (%s)", async (value) => {
    vi.mocked(marketGateway.getMarginShortRatioRanking).mockResolvedValue({
      tradeDate: "2026-08-30",
      limit: value,
      rankings: [],
      warnings: [],
    });

    await expect(getMarginShortRatioRanking(value, deps)).resolves.toBeDefined();
  });

  // analysis-ts attaches companyName directly on each row as of 2026-09-01 (see marketRankings.client.ts's
  // normalizeMarginShortRatioEntry) — passed straight through, no local merge step.
  it("passes each row's company name through directly from fetchMarginShortRatioRanking", async () => {
    vi.mocked(marketGateway.getMarginShortRatioRanking).mockResolvedValue({
      tradeDate: "2026-08-30",
      limit: 2,
      rankings: [
        { rank: 1, symbol: "3045", name: "台灣光罩", shortToMarginRatioPct: "44.35", marginTodayBalance: "717", shortTodayBalance: "318" },
        { rank: 2, symbol: "9999", name: null, shortToMarginRatioPct: "36.01", marginTodayBalance: "4476", shortTodayBalance: "1612" },
      ],
      warnings: [],
    });

    const result = await getMarginShortRatioRanking(2, deps);

    expect(result.rankings).toEqual([
      { rank: 1, symbol: "3045", name: "台灣光罩", shortToMarginRatioPct: "44.35", marginTodayBalance: "717", shortTodayBalance: "318" },
      { rank: 2, symbol: "9999", name: null, shortToMarginRatioPct: "36.01", marginTodayBalance: "4476", shortTodayBalance: "1612" },
    ]);
  });
});

describe("getMaterialAnnouncements", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(marketGateway.getMaterialAnnouncements).mockResolvedValue({ limit: 20, items: [], warnings: [] });

    await getMaterialAnnouncements(20, deps);

    expect(marketGateway.getMaterialAnnouncements).toHaveBeenCalledWith(20);
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getMaterialAnnouncements(value, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getMaterialAnnouncements).not.toHaveBeenCalled();
  });

  it.each([1, 50])("accepts the boundary values (%s)", async (value) => {
    vi.mocked(marketGateway.getMaterialAnnouncements).mockResolvedValue({ limit: value, items: [], warnings: [] });

    await expect(getMaterialAnnouncements(value, deps)).resolves.toBeDefined();
  });

  it("passes each item's company name through directly from fetchMaterialAnnouncements", async () => {
    vi.mocked(marketGateway.getMaterialAnnouncements).mockResolvedValue({
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

    const result = await getMaterialAnnouncements(1, deps);

    expect(result.items[0]?.name).toBe("世紀風電");
  });
});

describe("getRevenueRanking", () => {
  it("delegates valid metric/order/limit straight through", async () => {
    vi.mocked(marketGateway.getRevenueRanking).mockResolvedValue({
      yearMonth: "2026-07",
      metric: "yoy",
      order: "desc",
      limit: 20,
      rankings: [],
      warnings: [],
    });

    await getRevenueRanking("yoy", "desc", 20, deps);

    expect(marketGateway.getRevenueRanking).toHaveBeenCalledWith("yoy", "desc", 20);
  });

  it.each(["bogus", "", "YOY"])("rejects an invalid metric (%s) without calling analysis-ts", async (metric) => {
    await expect(getRevenueRanking(metric, "desc", 20, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getRevenueRanking).not.toHaveBeenCalled();
  });

  it.each(["bogus", "", "ASC"])("rejects an invalid order (%s) without calling analysis-ts", async (order) => {
    await expect(getRevenueRanking("yoy", order, 20, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getRevenueRanking).not.toHaveBeenCalled();
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getRevenueRanking("yoy", "desc", value, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getRevenueRanking).not.toHaveBeenCalled();
  });
});

describe("getVolumeTop20", () => {
  it("delegates straight through with no params", async () => {
    vi.mocked(marketGateway.getVolumeTop20).mockResolvedValue({ tradeDate: "2026-09-01", rankings: [] });

    await getVolumeTop20(deps);

    expect(marketGateway.getVolumeTop20).toHaveBeenCalledWith();
  });
});

describe("getDisposedStocks", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(marketGateway.getDisposedStocks).mockResolvedValue({ limit: 20, items: [], warnings: [] });

    await getDisposedStocks(20, deps);

    expect(marketGateway.getDisposedStocks).toHaveBeenCalledWith(20);
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getDisposedStocks(value, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getDisposedStocks).not.toHaveBeenCalled();
  });
});

describe("getAttentionStocks", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(marketGateway.getAttentionStocks).mockResolvedValue({ limit: 20, items: [], warnings: [] });

    await getAttentionStocks(20, deps);

    expect(marketGateway.getAttentionStocks).toHaveBeenCalledWith(20);
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getAttentionStocks(value, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getAttentionStocks).not.toHaveBeenCalled();
  });
});

describe("getPriceLimitRange", () => {
  it("delegates straight through with no params", async () => {
    vi.mocked(marketGateway.getPriceLimitRange).mockResolvedValue({ tradeDate: "2026-09-01", widest: [], narrowest: [] });

    await getPriceLimitRange(deps);

    expect(marketGateway.getPriceLimitRange).toHaveBeenCalledWith();
  });
});

describe("getPriceChangeRanking", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(marketGateway.getPriceChangeRanking).mockResolvedValue({ limit: 20, gainers: [], losers: [], warnings: [] });

    await getPriceChangeRanking(20, deps);

    expect(marketGateway.getPriceChangeRanking).toHaveBeenCalledWith(20);
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getPriceChangeRanking(value, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getPriceChangeRanking).not.toHaveBeenCalled();
  });

  it.each([1, 50])("accepts the boundary values (%s)", async (value) => {
    vi.mocked(marketGateway.getPriceChangeRanking).mockResolvedValue({ limit: value, gainers: [], losers: [], warnings: [] });

    await expect(getPriceChangeRanking(value, deps)).resolves.toBeDefined();
  });
});

describe("getEtfRanking", () => {
  it("delegates valid metric/order/limit straight through", async () => {
    vi.mocked(marketGateway.getEtfRanking).mockResolvedValue({ metric: "aum", order: "desc", limit: 20, rankings: [], warnings: [] });

    await getEtfRanking("aum", "desc", 20, deps);

    expect(marketGateway.getEtfRanking).toHaveBeenCalledWith("aum", "desc", 20);
  });

  it.each(["bogus", "", "AUM"])("rejects an invalid metric (%s) without calling analysis-ts", async (metric) => {
    await expect(getEtfRanking(metric, "desc", 20, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getEtfRanking).not.toHaveBeenCalled();
  });

  it.each(["bogus", "", "DESC"])("rejects an invalid order (%s) without calling analysis-ts", async (order) => {
    await expect(getEtfRanking("aum", order, 20, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getEtfRanking).not.toHaveBeenCalled();
  });

  // Bounds match analysis-ts's own validation (verified live: 1-50).
  it.each([0, -1, 51, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getEtfRanking("aum", "desc", value, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getEtfRanking).not.toHaveBeenCalled();
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
    vi.mocked(marketGateway.getEtfRanking).mockResolvedValue({ metric: metric as never, order: "desc", limit: 20, rankings: [], warnings: [] });

    await expect(getEtfRanking(metric, "desc", 20, deps)).resolves.toBeDefined();
  });
});

describe("getTaiexDailyPrice", () => {
  it("delegates a valid limit straight through", async () => {
    vi.mocked(marketGateway.getTaiexDailyPrice).mockResolvedValue({ entries: [] });

    await getTaiexDailyPrice(250, undefined, deps);

    expect(marketGateway.getTaiexDailyPrice).toHaveBeenCalledWith(250, undefined);
  });

  // Bounds match analysis-ts's own validation (verified live 2026-09-22: 1-8000, raised from 2000 in 113dd818).
  it.each([0, -1, 8001, 2.5])("rejects an out-of-range limit (%s) without calling analysis-ts", async (value) => {
    await expect(getTaiexDailyPrice(value, undefined, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getTaiexDailyPrice).not.toHaveBeenCalled();
  });

  // 2001 was the old first-rejected value — must now pass through so daily can reach 1999.
  it.each([1, 2001, 8000])("accepts a boundary limit (%s)", async (value) => {
    vi.mocked(marketGateway.getTaiexDailyPrice).mockResolvedValue({ entries: [] });

    await expect(getTaiexDailyPrice(value, undefined, deps)).resolves.toBeDefined();
  });

  // interval (2026-09-21): validated locally against the daily/weekly/monthly enum for a fast 400, then
  // forwarded as-is — analysis-ts enforces the same set.
  it.each(["daily", "weekly", "monthly"])("forwards a valid interval (%s)", async (interval) => {
    vi.mocked(marketGateway.getTaiexDailyPrice).mockResolvedValue({ entries: [] });

    await getTaiexDailyPrice(2000, interval, deps);

    expect(marketGateway.getTaiexDailyPrice).toHaveBeenCalledWith(2000, interval);
  });

  it("rejects an unknown interval without calling analysis-ts", async () => {
    await expect(getTaiexDailyPrice(250, "yearly", deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(marketGateway.getTaiexDailyPrice).not.toHaveBeenCalled();
  });
});
