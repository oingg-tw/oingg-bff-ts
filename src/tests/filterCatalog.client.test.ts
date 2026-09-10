import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFilterCatalog } from "@/domainBusiness/filterCatalog/filterCatalog.client.js";

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

// Real shape given directly by analysis-ts as of 2026-09-09: displayName/unit on every metric,
// categoryDisplayName on every category (added shortly after, same day) — the four allowedXxx arrays
// that briefly accompanied validTokens on 2026-09-08 were removed once analysis-ts confirmed this client
// never read them.
const RAW_CATEGORIES = [
  {
    categoryKey: "profitability",
    categoryDisplayName: "獲利能力",
    metrics: [
      { metricCode: "roe", displayName: "股東權益報酬率 (ROE)", unit: "%", validTokens: ["Q", "Q_ANN", "TTM"], sources: ["公開發行公司資產負債表（XBRL）"] },
    ],
  },
];

describe("fetchFilterCatalog", () => {
  it("requests /filters and converts validTokens into FilterCategory[] fields, using categoryDisplayName/displayName/unit", async () => {
    mockFetchOnce({ ok: true, body: { categories: RAW_CATEGORIES } });

    const result = await fetchFilterCatalog();

    expect(result).toEqual([
      {
        key: "profitability",
        name: "獲利能力",
        sort: 0,
        metrics: [
          {
            key: "roe",
            name: "股東權益報酬率 (ROE)",
            path: "roe",
            description: null,
            source: null,
            unit: "%",
            formulaLatex: null,
            referenceUrl: null,
            academicSourceUrl: null,
            badge: null,
            sources: ["公開發行公司資產負債表（XBRL）"],
            sort: 0,
            fields: [
              { key: "Q", name: "Q", period: "Q", description: null, source: null, unit: null, sort: 0 },
              { key: "Q_ANN", name: "Q_ANN", period: "Q_ANN", description: null, source: null, unit: null, sort: 1 },
              { key: "TTM", name: "TTM", period: "TTM", description: null, source: null, unit: null, sort: 2 },
            ],
          },
        ],
      },
    ]);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/metrics");
  });

  // Regression: beta's lookbackRange (1Y/2Y/5Y) x samplingInterval (1D/1W/1M) looked like a 3x3 cross
  // product when analysis-ts briefly exposed those raw arrays (2026-09-08), but only 3 pairings actually
  // have data (1Y_1D/2Y_1W/5Y_1M) — the other 6 returned empty results, not a 400. Caught this live before
  // analysis-ts added validTokens as the one authoritative list; this test guards against ever deriving
  // fields from anything other than validTokens, even if a future response includes extra sibling fields.
  it("ignores unrelated extra fields on a metric and only ever derives fields from validTokens", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "valuation",
            categoryDisplayName: "估值",
            metrics: [
              {
                metricCode: "beta",
                displayName: "貝塔係數",
                unit: "",
                allowedLookbackRanges: ["1Y", "2Y", "5Y"],
                allowedSamplingIntervals: ["1D", "1W", "1M"],
                validTokens: ["1Y_1D", "2Y_1W", "5Y_1M"],
                sources: ["證交所／櫃買中心每日收盤價", "加權股價指數（TAIEX）每日收盤價"],
              },
            ],
          },
        ],
      },
    });

    const result = await fetchFilterCatalog();

    expect(result[0]?.metrics[0]?.fields.map((f) => f.key)).toEqual(["1Y_1D", "2Y_1W", "5Y_1M"]);
  });

  // Regression: found live when oingg-analysis-ts's dev server happened to be down while testing
  // POST /filters/sync — fetch() itself throws for connection-level failures (refused/unreachable host),
  // not a rejected-but-received HTTP response, so this surfaced as an uncaught 500 instead of a clean 502.
  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the filters service responds with a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 503, body: {} });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response body has no "categories" array', async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a category is missing categoryKey or metrics", async () => {
    mockFetchOnce({ ok: true, body: { categories: [{ metrics: [] }] } });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  // Regression: caught live (2026-09-09) that a category could be missing categoryDisplayName right after
  // analysis-ts added it — must fail loudly rather than silently falling back to a placeholder, so a
  // partial rollout on their side surfaces immediately instead of quietly showing raw keys to users.
  it("throws a 502 AppError when a category is missing categoryDisplayName", async () => {
    mockFetchOnce({ ok: true, body: { categories: [{ categoryKey: "profitability", metrics: [] }] } });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a metric is missing metricCode or validTokens", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          { categoryKey: "profitability", categoryDisplayName: "獲利能力", metrics: [{ metricCode: "roe", displayName: "ROE", unit: "%" }] },
        ],
      },
    });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a metric is missing displayName or unit", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [{ categoryKey: "profitability", categoryDisplayName: "獲利能力", metrics: [{ metricCode: "roe", validTokens: ["TTM"] }] }],
      },
    });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  // formulaLatex pilot (2026-09-10): absent entirely (not an empty string) on metrics analysis-ts hasn't
  // documented yet — must resolve to null, not throw and not be required.
  it("passes through formulaLatex when present, and defaults to null when absent", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              {
                metricCode: "roe",
                displayName: "股東權益報酬率 (ROE)",
                unit: "%",
                validTokens: ["TTM"],
                formulaLatex: "\\mathrm{ROE} = \\frac{\\mathrm{NetIncome}}{\\mathrm{Equity}} \\times 100",
                sources: ["公開發行公司資產負債表（XBRL）"],
              },
              { metricCode: "roa", displayName: "資產報酬率 (ROA)", unit: "%", validTokens: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"] },
            ],
          },
        ],
      },
    });

    const result = await fetchFilterCatalog();

    expect(result[0]?.metrics[0]?.formulaLatex).toBe("\\mathrm{ROE} = \\frac{\\mathrm{NetIncome}}{\\mathrm{Equity}} \\times 100");
    expect(result[0]?.metrics[1]?.formulaLatex).toBeNull();
  });

  it("throws a 502 AppError when formulaLatex is present but not a string", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", displayName: "ROE", unit: "%", validTokens: ["TTM"], formulaLatex: 123 }],
          },
        ],
      },
    });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  // referenceUrl (2026-09-10, same rollout as formulaLatex): absent entirely (not an empty string) on
  // metrics analysis-ts hasn't documented a reference link for yet — must resolve to null, not throw.
  it("passes through referenceUrl when present, and defaults to null when absent", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              {
                metricCode: "dividendPayoutRatio",
                displayName: "盈餘發放率",
                unit: "%",
                validTokens: ["TTM"],
                referenceUrl: "https://en.wikipedia.org/wiki/Dividend_payout_ratio",
                sources: ["公開發行公司現金流量表（XBRL）"],
              },
              { metricCode: "roa", displayName: "資產報酬率 (ROA)", unit: "%", validTokens: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"] },
            ],
          },
        ],
      },
    });

    const result = await fetchFilterCatalog();

    expect(result[0]?.metrics[0]?.referenceUrl).toBe("https://en.wikipedia.org/wiki/Dividend_payout_ratio");
    expect(result[0]?.metrics[1]?.referenceUrl).toBeNull();
  });

  it("throws a 502 AppError when referenceUrl is present but not a string", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", displayName: "ROE", unit: "%", validTokens: ["TTM"], referenceUrl: 123 }],
          },
        ],
      },
    });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  // academicSourceUrl (2026-09-10, added alongside referenceUrl but on a narrower ~13-metric set): a
  // DIFFERENT link from referenceUrl, not a duplicate — analysis-ts's own distinction: referenceUrl is a
  // general-reader explanation, academicSourceUrl points at the original academic paper.
  it("passes through academicSourceUrl when present, and defaults to null when absent", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              {
                metricCode: "sue",
                displayName: "標準化未預期盈餘 (SUE)",
                unit: "",
                validTokens: ["Q"],
                academicSourceUrl: "https://doi.org/10.2307/2491062",
                sources: ["公開發行公司損益表（XBRL）"],
              },
              { metricCode: "roa", displayName: "資產報酬率 (ROA)", unit: "%", validTokens: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"] },
            ],
          },
        ],
      },
    });

    const result = await fetchFilterCatalog();

    expect(result[0]?.metrics[0]?.academicSourceUrl).toBe("https://doi.org/10.2307/2491062");
    expect(result[0]?.metrics[1]?.academicSourceUrl).toBeNull();
  });

  it("throws a 502 AppError when academicSourceUrl is present but not a string", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", displayName: "ROE", unit: "%", validTokens: ["TTM"], academicSourceUrl: 123 }],
          },
        ],
      },
    });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  // badge (2026-09-10, same rollout wave): the "guru badge" methodology object, moved from web-nuxt's own
  // hardcoded GURU_BADGES table into analysis-ts's MetricDefinitionSpec. Present only on the ~11 metrics
  // that table covered (Piotroski excluded by mutual agreement) — absent entirely elsewhere, resolves to null.
  const SAMPLE_BADGE = {
    id: "graham-number",
    name: "Graham Number",
    nameEn: "Graham Number",
    author: "Benjamin Graham",
    summary: "summary",
    detail: "detail",
    token: "TTM",
    threshold: { description: "股價 < Graham Number", denominator: 1, comparator: "lt" as const, compareAgainstFieldId: "stockPrice.Q" },
  };

  it("passes through badge when present, and defaults to null when absent", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              {
                metricCode: "grahamNumber",
                displayName: "Graham Number",
                unit: "元",
                validTokens: ["TTM"],
                badge: SAMPLE_BADGE,
                sources: ["公開發行公司資產負債表（XBRL）", "公開發行公司損益表（XBRL）"],
              },
              { metricCode: "roa", displayName: "資產報酬率 (ROA)", unit: "%", validTokens: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"] },
            ],
          },
        ],
      },
    });

    const result = await fetchFilterCatalog();

    expect(result[0]?.metrics[0]?.badge).toEqual(SAMPLE_BADGE);
    expect(result[0]?.metrics[1]?.badge).toBeNull();
  });

  it("passes through a badge threshold using allPositiveFieldIds instead of comparator/value, with token entirely absent (eps's real shape)", async () => {
    const { token: _token, ...badgeWithoutToken } = SAMPLE_BADGE;
    const epsBadge = {
      ...badgeWithoutToken,
      id: "sp500-earnings-eligibility",
      threshold: { description: "近四季 EPS 合計為正", denominator: 1, allPositiveFieldIds: ["eps.TTM", "eps.Q"] },
    };
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              {
                metricCode: "eps",
                displayName: "EPS",
                unit: "元",
                validTokens: ["TTM", "Q"],
                badge: epsBadge,
                sources: ["公開發行公司損益表（XBRL）"],
              },
            ],
          },
        ],
      },
    });

    const result = await fetchFilterCatalog();

    expect(result[0]?.metrics[0]?.badge?.threshold.allPositiveFieldIds).toEqual(["eps.TTM", "eps.Q"]);
    expect(result[0]?.metrics[0]?.badge?.token).toBeUndefined();
  });

  it("throws a 502 AppError when badge is present but missing required fields", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              {
                metricCode: "grahamNumber",
                displayName: "Graham Number",
                unit: "元",
                validTokens: ["TTM"],
                badge: { ...SAMPLE_BADGE, threshold: { description: "missing denominator" } },
              },
            ],
          },
        ],
      },
    });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when badge.threshold.comparator is not one of the allowed enum values", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              {
                metricCode: "grahamNumber",
                displayName: "Graham Number",
                unit: "元",
                validTokens: ["TTM"],
                badge: { ...SAMPLE_BADGE, threshold: { ...SAMPLE_BADGE.threshold, comparator: "eq" } },
              },
            ],
          },
        ],
      },
    });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  // in_range (2026-09-10, dividendPayoutRatio's Fidelity-range correction): pairs with valueMin/valueMax
  // instead of a single value — the original "< 60%" threshold was a mistake, the real Fidelity conclusion
  // is a 40-60% two-sided range.
  it("passes through a badge threshold using comparator: in_range with valueMin/valueMax", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              {
                metricCode: "dividendPayoutRatio",
                displayName: "盈餘發放率",
                unit: "%",
                validTokens: ["TTM"],
                sources: ["公開發行公司現金流量表（XBRL）"],
                badge: {
                  ...SAMPLE_BADGE,
                  id: "dividend-payout-ratio-safety",
                  threshold: { description: "40%-60%", denominator: 1, comparator: "in_range" as const, valueMin: 40, valueMax: 60 },
                },
              },
            ],
          },
        ],
      },
    });

    const result = await fetchFilterCatalog();

    expect(result[0]?.metrics[0]?.badge?.threshold).toMatchObject({ comparator: "in_range", valueMin: 40, valueMax: 60 });
  });

  // sources (2026-09-10): unlike formulaLatex/referenceUrl/badge, analysis-ts guarantees this is always
  // present and non-empty — required here, not defaulted to null/undefined when absent.
  it("passes through sources", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              {
                metricCode: "roe",
                displayName: "ROE",
                unit: "%",
                validTokens: ["TTM"],
                sources: ["公開發行公司資產負債表（XBRL）", "公開發行公司損益表（XBRL）"],
              },
            ],
          },
        ],
      },
    });

    const result = await fetchFilterCatalog();

    expect(result[0]?.metrics[0]?.sources).toEqual(["公開發行公司資產負債表（XBRL）", "公開發行公司損益表（XBRL）"]);
  });

  it("throws a 502 AppError when sources is missing entirely", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", displayName: "ROE", unit: "%", validTokens: ["TTM"] }],
          },
        ],
      },
    });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when sources is present but not an array of strings", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", displayName: "ROE", unit: "%", validTokens: ["TTM"], sources: [123] }],
          },
        ],
      },
    });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("handles an empty validTokens array (zero queryable fields for that metric)", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", displayName: "ROE", unit: "%", validTokens: [], sources: ["公開發行公司資產負債表（XBRL）"] }],
          },
        ],
      },
    });

    const result = await fetchFilterCatalog();

    expect(result[0]?.metrics[0]?.fields).toEqual([]);
  });
});
