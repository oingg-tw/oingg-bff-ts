import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchValuationRiver } from "@/infrastructure/analysisApi/stock/valuationRiver.client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FILTERS_URL = process.env.FILTERS_SERVICE_URL;

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://filters.test";
  process.env.BFF_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_FILTERS_URL === undefined) {
    delete process.env.FILTERS_SERVICE_URL;
  } else {
    process.env.FILTERS_SERVICE_URL = ORIGINAL_FILTERS_URL;
  }
});

function mockFetchOnce(body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as typeof fetch;
}

function calledUrl(): string {
  const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
  return url.toString();
}

/** 6116 全期間虧損的真實形狀（2026-10-08 實測）：每個可為 null 的欄位都要原樣是 null，不能變 0。 */
const ALL_LOSS = {
  symbol: "6116",
  ratio: "pe",
  basisNote: "河道線 = 每股基準 × 倍數；……",
  lookback: { requestedYears: 3, from: "2023-10-11", to: "2026-10-06" },
  sampleDays: 0,
  bandMultiples: null,
  ratioRange: null,
  current: { tradeDate: "2026-10-06", price: 15.45, base: -0.19, ratio: null, percentile: null },
  prices: [{ tradeDate: "2026-10-06", close: 15.45 }],
  bases: [{ effectiveFrom: "2026-08-14", base: -0.19, fiscalYear: 2026, fiscalQuarter: null, knowledgeDateIsFallback: true }],
};

describe("fetchValuationRiver", () => {
  it("虧損股的 null 原樣保留，lookbackYears 有給才轉發", async () => {
    mockFetchOnce(ALL_LOSS);

    const result = await fetchValuationRiver("6116", "pe", 3);

    expect(result).toEqual(ALL_LOSS);
    expect(calledUrl()).toBe("http://filters.test/companies/valuation-river?symbol=6116&ratio=pe&lookbackYears=3");
  });

  it("沒給 lookbackYears 時不送，讓上游用自己的預設；查無代號的空殼照樣通過", async () => {
    const empty = { ...ALL_LOSS, symbol: "9999", lookback: { requestedYears: 5, from: null, to: null }, current: null, prices: [], bases: [] };
    mockFetchOnce(empty);

    expect(await fetchValuationRiver("9999", "pe")).toEqual(empty);
    expect(calledUrl()).toBe("http://filters.test/companies/valuation-river?symbol=9999&ratio=pe");
  });

  it("上游保證的欄位缺了回 502，不靜默補值", async () => {
    mockFetchOnce({ ...ALL_LOSS, prices: [{ tradeDate: "2026-10-06", close: null }] });

    await expect(fetchValuationRiver("6116", "pe")).rejects.toMatchObject({ statusCode: 502 });
  });
});
