import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/market/marketRankings.client.js", () => ({
  fetchForeignHoldingRanking: vi.fn(),
  fetchMarginShortRatioRanking: vi.fn(),
}));

import { fetchForeignHoldingRanking, fetchMarginShortRatioRanking } from "@/domains/market/marketRankings.client.js";
import { getForeignHoldingRanking, getMarginShortRatioRanking } from "@/domains/market/market.service.js";

beforeEach(() => {
  vi.mocked(fetchForeignHoldingRanking).mockReset();
  vi.mocked(fetchMarginShortRatioRanking).mockReset();
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
