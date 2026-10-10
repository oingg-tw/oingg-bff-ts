import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMetricsHistory } from "@/infrastructure/analysisApi/stock/metricsHistory.client.js";

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
      dataType: "2",
      values: {
        netIncomeGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 3, restated: null, shareBasisDate: null },
        epsGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 3, restated: null, shareBasisDate: null },
        shareCountChangeRate: { value: 0, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 3, restated: null, shareBasisDate: null },
      },
    },
  ],
};

describe("fetchMetricsHistory", () => {
  // 上游 2026-10-08 起：每個 code 一組 coverage；每股類（eps）的格子帶 restated／shareBasisDate，非每股類（roe）沒有 → null。
  it("帶出每個 code 的 coverage 與每股換算欄位，非每股類是 null 而不是 false", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        ...RAW_BODY,
        coverage: { eps: { from: "2019Q4", to: "2026Q2" }, roe: { from: "2019Q4", to: null }, junk: 5 },
        entries: [{ fiscalYear: 2026, fiscalQuarter: 1, dataType: "2", values: {
          eps: { value: 86.27, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 2, restated: false, shareBasisDate: "2026-10-08" },
          roe: { value: 40.94, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 2 },
        } }],
      },
    });

    const result = await fetchMetricsHistory("2330", ["eps", "roe"], "TTM");

    expect(result.coverage).toEqual({ eps: { from: "2019Q4", to: "2026Q2" }, roe: { from: "2019Q4", to: null } });
    expect(result.entries[0]?.values.eps).toMatchObject({ restated: false, shareBasisDate: "2026-10-08" });
    expect(result.entries[0]?.values.roe).toMatchObject({ restated: null, shareBasisDate: null });
  });

  it("requests /companies/metrics-history with symbol/metricCodes(joined by comma)/token and normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchMetricsHistory("2330", ["netIncomeGrowthRate", "epsGrowthRate", "shareCountChangeRate"], "Q");

    expect(result).toEqual({
      symbol: "2330",
      metricCodes: ["netIncomeGrowthRate", "epsGrowthRate", "shareCountChangeRate"],
      timeframe: "Q",
      token: "Q",
      total: 1,
      hasMore: false,
      coverage: {},
      entries: RAW_BODY.entries,
    });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe(
      "http://filters.test/companies/metrics-history?symbol=2330&metricCodes=netIncomeGrowthRate%2CepsGrowthRate%2CshareCountChangeRate&timeframe=Q",
    );
  });

  it("includes limit in the request when given", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    await fetchMetricsHistory("2330", ["roe"], "TTM", 5);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/metrics-history?symbol=2330&metricCodes=roe&timeframe=TTM&limit=5");
  });

  it("returns an empty entries array for an unknown symbol, without throwing", async () => {
    mockFetchOnce({
      ok: true,
      body: { symbol: "NOPE", metricCodes: ["roe"], token: "TTM", total: 0, hasMore: false, entries: [] },
    });

    await expect(fetchMetricsHistory("NOPE", ["roe"], "TTM")).resolves.toEqual({
      symbol: "NOPE",
      metricCodes: ["roe"],
      timeframe: "TTM",
      token: "TTM",
      total: 0,
      hasMore: false,
      coverage: {},
      entries: [],
    });
  });

  it("preserves a null value with its nullReason inside the per-metric values map", async () => {
    const entry = {
      fiscalYear: 2024,
      fiscalQuarter: 4,
      dataType: "2",
      values: {
        roe: { value: null, nullReason: "缺少前四季損益表資料", knowledgeDate: "2025-02-10", knowledgeDateIsFallback: false, formulaVersion: 3 },
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
            dataType: "2",
            values: {
              netIncomeGrowthRate: { value: 10, nullReason: null, knowledgeDate: "2025-11-11", knowledgeDateIsFallback: false, formulaVersion: 3 },
              epsGrowthRate: { value: 10, nullReason: null, knowledgeDate: "2025-11-11", knowledgeDateIsFallback: false, formulaVersion: 3 },
              // shareCountChangeRate not yet backfilled for this period — simply absent, not present as null.
            },
          },
          {
            fiscalYear: 2026,
            fiscalQuarter: 1,
            dataType: "2",
            values: {
              netIncomeGrowthRate: { value: 20, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false, formulaVersion: 3 },
              epsGrowthRate: { value: 20, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false, formulaVersion: 3 },
            },
          },
          {
            fiscalYear: 2026,
            fiscalQuarter: 2,
            dataType: "2",
            values: {
              netIncomeGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 3 },
              epsGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 3 },
              shareCountChangeRate: { value: 0, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 3 },
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

  // Regression (2026-09-10): the ACTUAL bug behind a second, reproducible 500 report (superficially the
  // same "one metricCode has fewer backfilled periods" symptom as the incident above, but a genuinely
  // different cause). Confirmed live against analysis-ts directly: a metricCode with no data at all for a
  // period is the literal JSON `null` (not an object, and not simply absent from `values`) — e.g.
  // fixedAssetTurnover backfilled only from 2024Q3 while assetTurnover in the same request went back to
  // 2024Q2, so 2024Q2's fixedAssetTurnover entry was `null`. The old normalizeValue did
  // `(raw as Record<string, unknown>).value`, which type-checks against `unknown` but throws
  // "Cannot read properties of null" at runtime when raw is actually `null` — reproduced with
  // limit >= 9 (the exact point earlier periods entered the page). Must preserve `null` as-is, not throw
  // and not coerce it into a fake object with a fabricated knowledgeDate.
  it("preserves a literal null value (not an object) for a metricCode with zero data in a period, without throwing", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "2330",
        metricCodes: ["assetTurnover", "fixedAssetTurnover"],
        token: "TTM",
        total: 23,
        hasMore: true,
        entries: [
          {
            fiscalYear: 2024,
            fiscalQuarter: 2,
            dataType: "2",
            values: {
              assetTurnover: { value: 0.41, nullReason: null, knowledgeDate: "2024-08-13", knowledgeDateIsFallback: false, formulaVersion: 3 },
              fixedAssetTurnover: null,
            },
          },
          {
            fiscalYear: 2024,
            fiscalQuarter: 3,
            dataType: "2",
            values: {
              assetTurnover: { value: 0.43, nullReason: null, knowledgeDate: "2024-11-12", knowledgeDateIsFallback: false, formulaVersion: 3 },
              fixedAssetTurnover: { value: 0.86, nullReason: null, knowledgeDate: "2024-11-12", knowledgeDateIsFallback: false, formulaVersion: 3 },
            },
          },
        ],
      },
    });

    const result = await fetchMetricsHistory("2330", ["assetTurnover", "fixedAssetTurnover"], "TTM", 9);

    expect(result.entries[0]?.values.fixedAssetTurnover).toBeNull();
    expect(result.entries[0]?.values.assetTurnover?.value).toBe(0.41);
    expect(result.entries[1]?.values.fixedAssetTurnover?.value).toBe(0.86);
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

/**
 * 同一個欄位在這一層要分兩種「沒有版本號」，混在一起處理會讓下游誤判：
 *   - values[metricCode] 整格是 null → 那個指標在這一期從來沒回填過，連格子都不存在（見上面的 null 值測試）
 *   - 格子存在但 formulaVersion 是 null → 上游這一次沒送這個欄位
 * 前者不是「過期」，後者才是「不知道是否過期」。
 */
describe("fetchMetricsHistory 的 formulaVersion", () => {
  it("每個 metricCode 的格子各自帶自己的版本號", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        ...RAW_BODY,
        entries: [
          {
            fiscalYear: 2026,
            fiscalQuarter: 2,
            dataType: "2",
            values: {
              netIncomeGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 5 },
              // 同一期不同指標可以是不同版本：重算是逐指標進行的，不是整批一起跳。
              epsGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 2 },
            },
          },
        ],
      },
    });

    const values = (await fetchMetricsHistory("2330", ["netIncomeGrowthRate", "epsGrowthRate"], "Q")).entries[0]?.values;

    expect(values?.netIncomeGrowthRate?.formulaVersion).toBe(5);
    expect(values?.epsGrowthRate?.formulaVersion).toBe(2);
  });

  it("整格是 null 跟格子裡版本號是 null 是兩回事", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        ...RAW_BODY,
        entries: [
          {
            fiscalYear: 2026,
            fiscalQuarter: 2,
            dataType: "2",
            values: {
              netIncomeGrowthRate: null,
              epsGrowthRate: { value: 12.3, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false },
            },
          },
        ],
      },
    });

    const values = (await fetchMetricsHistory("2330", ["netIncomeGrowthRate", "epsGrowthRate"], "Q")).entries[0]?.values;

    expect(values?.netIncomeGrowthRate).toBeNull();
    expect(values?.epsGrowthRate).not.toBeNull();
    expect(values?.epsGrowthRate?.formulaVersion).toBeNull();
    expect(values?.epsGrowthRate?.value).toBe(12.3);
  });
});
