import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompanyBadges } from "@/infrastructure/analysisApi/stock/companyBadges.client.js";

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

// Real shape given directly by analysis-ts (2026-09-14; knowledgeDate/knowledgeDateIsFallback added same
// day, commit 7bf2ff7; warning added 2026-09-20 — null on every non-piotroskiFScore badge even with a
// real passed value, confirmed live, not just when value itself is null; percentile/rank/totalCount added
// 2026-09-21, always present but only non-null for a percentileRank-threshold badge — see
// metricCatalog.types.ts's MetricBadgePercentileRank; thresholdValue added 2026-09-22 (9b51128f), null
// under the same condition as percentile).
const RAW_BODY = {
  symbol: "2330",
  categories: [
    {
      categoryKey: "resilience",
      categoryDisplayName: "財務韌性",
      badges: [
        {
          metricCode: "altmanZScore",
          name: "Altman Z-Score",
          nameEn: "Altman Z-Score",
          timeframe: "TTM",
          value: 15.51,
          nullReason: null,
          knowledgeDate: "2026-09-11",
          knowledgeDateIsFallback: false,
          passed: true,
          warning: null,
          percentile: null,
          rank: null,
          totalCount: null,
          thresholdValue: null,
        },
        {
          metricCode: "altmanZDoublePrimeScore",
          name: "Altman Z''-Score",
          nameEn: "Altman Z''-Score",
          timeframe: "TTM",
          value: null,
          nullReason: "not_applicable_industry",
          knowledgeDate: null,
          knowledgeDateIsFallback: null,
          passed: null,
          warning: null,
          percentile: null,
          rank: null,
          totalCount: null,
          thresholdValue: null,
        },
      ],
    },
  ],
};

describe("fetchCompanyBadges", () => {
  it("requests /companies/badges?symbol= and normalizes categories/badges", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchCompanyBadges("2330");

    expect(result).toEqual(RAW_BODY);
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/companies/badges?symbol=2330");
  });

  // The whole point of this endpoint (per analysis-ts): passed is a precomputed source of truth, never
  // re-derived from value + a threshold — this test just confirms it survives normalization untouched.
  it("passes through a null value/passed pair for an industry-excluded badge", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchCompanyBadges("2330");

    expect(result.categories[0]?.badges[1]).toEqual({
      metricCode: "altmanZDoublePrimeScore",
      name: "Altman Z''-Score",
      nameEn: "Altman Z''-Score",
      timeframe: "TTM",
      value: null,
      nullReason: "not_applicable_industry",
      knowledgeDate: null,
      knowledgeDateIsFallback: null,
      passed: null,
      warning: null,
      percentile: null,
      rank: null,
      totalCount: null,
      thresholdValue: null,
    });
  });

  // warning is null for every badge without a defined danger-zone threshold, even when passed has a real
  // value (confirmed live: only piotroskiFScore's badge defines one as of 2026-09-20) — must not collapse
  // to false just because the sibling `passed` field is non-null.
  it("passes through warning:true/false for a badge with a defined danger-zone threshold (piotroskiFScore)", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "2454",
        categories: [
          {
            categoryKey: "resilience",
            categoryDisplayName: "財務韌性",
            badges: [
              { metricCode: "piotroskiFScore", name: "Piotroski F-Score", nameEn: "Piotroski F-Score", timeframe: "Q", value: 2, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, passed: false, warning: true },
            ],
          },
        ],
      },
    });

    const result = await fetchCompanyBadges("2454");

    expect(result.categories[0]?.badges[0]?.warning).toBe(true);
  });

  // percentile/rank/totalCount (2026-09-21): non-null only for a badge whose threshold is a
  // percentileRank (cross-sectional ranking) shape, e.g. novyMarxGpToAssets's "top 20% of the market".
  it("passes through percentile/rank/totalCount for a badge with a percentileRank threshold", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "2330",
        categories: [
          {
            categoryKey: "growth",
            categoryDisplayName: "成長動能",
            badges: [
              {
                metricCode: "novyMarxGpToAssets",
                name: "毛利資產比五分位",
                nameEn: "Novy-Marx Gross Profitability",
                timeframe: "TTM",
                value: 0.42,
                nullReason: null,
                knowledgeDate: "2026-08-11",
                knowledgeDateIsFallback: false,
                passed: true,
                warning: null,
                percentile: 92.5,
                rank: 118,
                totalCount: 1583,
                thresholdValue: 23.78,
              },
            ],
          },
        ],
      },
    });

    const result = await fetchCompanyBadges("2330");

    expect(result.categories[0]?.badges[0]).toMatchObject({ percentile: 92.5, rank: 118, totalCount: 1583, thresholdValue: 23.78 });
  });

  // thresholdValue (2026-09-22) can legitimately be 0 (live: 2330 shareholderYield thresholdValue 0,
  // percentile 88.6) — a falsy-check normalizer would silently turn a real cutoff into "missing".
  it("preserves a thresholdValue of exactly 0", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "2330",
        categories: [
          {
            categoryKey: "shareholder",
            categoryDisplayName: "股東回報",
            badges: [
              { metricCode: "shareholderYield", name: "股東收益率", nameEn: "Shareholder Yield", timeframe: "TTM", value: 0.85, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, passed: true, warning: null, percentile: 88.6, rank: 180, totalCount: 1583, thresholdValue: 0 },
            ],
          },
        ],
      },
    });

    const result = await fetchCompanyBadges("2330");

    expect(result.categories[0]?.badges[0]?.thresholdValue).toBe(0);
  });

  it("passes through knowledgeDate/knowledgeDateIsFallback for a badge with data", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchCompanyBadges("2330");

    expect(result.categories[0]?.badges[0]).toMatchObject({
      knowledgeDate: "2026-09-11",
      knowledgeDateIsFallback: false,
    });
  });

  // Confirmed live: an unknown/not-yet-backfilled symbol is still a 200, every badge entirely null.
  it("returns all-null badges without throwing for an unknown symbol", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "NOPE9999",
        categories: [
          {
            categoryKey: "resilience",
            categoryDisplayName: "財務韌性",
            badges: [{ metricCode: "altmanZScore", name: "Altman Z-Score", nameEn: "Altman Z-Score", timeframe: "TTM", value: null, nullReason: null, passed: null }],
          },
        ],
      },
    });

    const result = await fetchCompanyBadges("NOPE9999");

    expect(result.categories[0]?.badges[0]).toMatchObject({ value: null, passed: null });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchCompanyBadges("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchCompanyBadges("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing symbol/categories", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchCompanyBadges("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});
