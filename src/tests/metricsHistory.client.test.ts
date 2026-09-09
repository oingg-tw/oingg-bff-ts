import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMetricsHistory } from "@/domainBff/stock/metricsHistory.client.js";

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

// Real body given directly by analysis-ts (2026-09-09).
const RAW_BODY = {
  symbol: "2330",
  metricCodes: ["netIncomeGrowthRate", "epsGrowthRate", "shareCountChangeRate"],
  token: "Q",
  total: 1,
  hasMore: false,
  entries: [
    {
      fiscalYear: 2026,
      fiscalQuarter: 2,
      values: {
        netIncomeGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false },
        epsGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false },
        shareCountChangeRate: { value: 0, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false },
      },
    },
  ],
};

describe("fetchMetricsHistory", () => {
  it("requests /companies/metrics-history with symbol/metricCodes(joined by comma)/token and normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchMetricsHistory("2330", ["netIncomeGrowthRate", "epsGrowthRate", "shareCountChangeRate"], "Q");

    expect(result).toEqual({
      symbol: "2330",
      metricCodes: ["netIncomeGrowthRate", "epsGrowthRate", "shareCountChangeRate"],
      token: "Q",
      total: 1,
      hasMore: false,
      entries: RAW_BODY.entries,
    });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe(
      "http://filters.test/companies/metrics-history?symbol=2330&metricCodes=netIncomeGrowthRate%2CepsGrowthRate%2CshareCountChangeRate&token=Q",
    );
  });

  it("includes limit in the request when given", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    await fetchMetricsHistory("2330", ["roe"], "TTM", 5);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/metrics-history?symbol=2330&metricCodes=roe&token=TTM&limit=5");
  });

  it("returns an empty entries array for an unknown symbol, without throwing", async () => {
    mockFetchOnce({
      ok: true,
      body: { symbol: "NOPE", metricCodes: ["roe"], token: "TTM", total: 0, hasMore: false, entries: [] },
    });

    await expect(fetchMetricsHistory("NOPE", ["roe"], "TTM")).resolves.toEqual({
      symbol: "NOPE",
      metricCodes: ["roe"],
      token: "TTM",
      total: 0,
      hasMore: false,
      entries: [],
    });
  });

  it("preserves a null value with its nullReason inside the per-metric values map", async () => {
    const entry = {
      fiscalYear: 2024,
      fiscalQuarter: 4,
      values: {
        roe: { value: null, nullReason: "缺少前四季損益表資料", knowledgeDate: "2025-02-10", knowledgeDateIsFallback: false },
      },
    };
    mockFetchOnce({ ok: true, body: { ...RAW_BODY, entries: [entry] } });

    const result = await fetchMetricsHistory("2330", ["roe"], "TTM");

    expect(result.entries[0]?.values.roe?.value).toBeNull();
    expect(result.entries[0]?.values.roe?.nullReason).toBe("缺少前四季損益表資料");
  });

  // Regression: web-nuxt hit a 500 (theorized as bff-ts assuming every requested metricCode has an
  // equal-length backfilled array and merging positionally) when one of 3 requested metricCodes
  // (shareCountChangeRate) had only 1 backfilled period while the other 2 had 23 — resolved once
  // analysis-ts backfilled the gap, but code review found no positional-array-merge logic here at all:
  // each entry's `values` is read directly from analysis-ts's own per-period object, keyed by metricCode,
  // with no length-equality assumption across periods. This test proves that directly: some periods carry
  // only a subset of the requested metricCodes (simulating one metric backfilled less than the others),
  // and normalization must not throw or drop the period, just return whatever keys are actually present.
  it("does not throw when different periods have different subsets of the requested metricCodes present", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "2330",
        metricCodes: ["netIncomeGrowthRate", "epsGrowthRate", "shareCountChangeRate"],
        token: "Q",
        total: 3,
        hasMore: false,
        entries: [
          {
            fiscalYear: 2025,
            fiscalQuarter: 4,
            values: {
              netIncomeGrowthRate: { value: 10, nullReason: null, knowledgeDate: "2025-11-11", knowledgeDateIsFallback: false },
              epsGrowthRate: { value: 10, nullReason: null, knowledgeDate: "2025-11-11", knowledgeDateIsFallback: false },
              // shareCountChangeRate not yet backfilled for this period — simply absent, not present as null.
            },
          },
          {
            fiscalYear: 2026,
            fiscalQuarter: 1,
            values: {
              netIncomeGrowthRate: { value: 20, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false },
              epsGrowthRate: { value: 20, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false },
            },
          },
          {
            fiscalYear: 2026,
            fiscalQuarter: 2,
            values: {
              netIncomeGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false },
              epsGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false },
              shareCountChangeRate: { value: 0, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false },
            },
          },
        ],
      },
    });

    const result = await fetchMetricsHistory("2330", ["netIncomeGrowthRate", "epsGrowthRate", "shareCountChangeRate"], "Q", 3);

    expect(result.entries).toHaveLength(3);
    expect(Object.keys(result.entries[0]!.values)).toEqual(["netIncomeGrowthRate", "epsGrowthRate"]);
    expect(result.entries[0]?.values.shareCountChangeRate).toBeUndefined();
    expect(result.entries[2]?.values.shareCountChangeRate?.value).toBe(0);
  });

  // analysis-ts validates each metricCode supports the given token itself (e.g. growth-decomposition
  // codes only allow "Q", not "TTM") and returns a 400 with a clear message — must be relayed as-is.
  it("relays analysis-ts's 400 message for a metricCode that doesn't support the given token", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      body: { message: '"netIncomeGrowthRate.TTM" 不是可查詢的欄位——metricCode "netIncomeGrowthRate" 不支援 periodType "TTM"，允許的值：Q。' },
    });

    await expect(fetchMetricsHistory("2330", ["netIncomeGrowthRate"], "TTM")).rejects.toMatchObject({
      statusCode: 400,
      message: '"netIncomeGrowthRate.TTM" 不是可查詢的欄位——metricCode "netIncomeGrowthRate" 不支援 periodType "TTM"，允許的值：Q。',
    });
  });

  it("falls back to a generic 400 message when analysis-ts's 400 body has none", async () => {
    mockFetchOnce({ ok: false, status: 400, body: {} });

    await expect(fetchMetricsHistory("2330", ["roe"], "TTM")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchMetricsHistory("2330", ["roe"], "TTM")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx, non-400 status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchMetricsHistory("2330", ["roe"], "TTM")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing an entries array", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330" } });

    await expect(fetchMetricsHistory("2330", ["roe"], "TTM")).rejects.toMatchObject({ statusCode: 502 });
  });
});
