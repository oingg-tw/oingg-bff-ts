import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMetricCatalog } from "@/infrastructure/analysisApi/metricCatalog/metricCatalog.client.js";

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

// Real shape given directly by analysis-ts as of 2026-09-09: name/unit on every metric,
// categoryDisplayName on every category (added shortly after, same day) — the four allowedXxx arrays
// that briefly accompanied validTokens on 2026-09-08 were removed once analysis-ts confirmed this client
// never read them.
const RAW_CATEGORIES = [
  {
    categoryKey: "profitability",
    categoryDisplayName: "獲利能力",
    metrics: [
      { metricCode: "roe", name: "股東權益報酬率 (ROE)", unit: "%", validTimeframes: ["Q", "Q_ANN", "TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1 },
    ],
  },
];

describe("fetchMetricCatalog", () => {
  it("requests /filters and converts validTokens into MetricCategory[] fields, using categoryDisplayName/name/unit", async () => {
    mockFetchOnce({ ok: true, body: { categories: RAW_CATEGORIES } });

    const result = await fetchMetricCatalog();

    expect(result).toEqual([
      {
        key: "profitability",
        name: "獲利能力",
        sort: 0,
        metrics: [
          {
            key: "roe",
            name: "股東權益報酬率 (ROE)",
            nameEn: null,
            path: "roe",
            description: null,
            source: null,
            limitations: null,
            misreadings: null,
            unit: "%",
            formulaLatex: null,
            referenceUrl: null,
            academicSourceUrl: null,
            badge: null,
            sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1,
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
                name: "貝塔係數",
                unit: "",
                allowedLookbackRanges: ["1Y", "2Y", "5Y"],
                allowedSamplingIntervals: ["1D", "1W", "1M"],
                validTimeframes: ["1Y_1D", "2Y_1W", "5Y_1M"],
                sources: ["證交所／櫃買中心每日收盤價", "加權股價指數（TAIEX）每日收盤價"], hasProvenance: true, formulaVersion: 1,
              },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

    expect(result[0]?.metrics[0]?.fields.map((f) => f.key)).toEqual(["1Y_1D", "2Y_1W", "5Y_1M"]);
  });

  // Regression: found live when oingg-analysis-ts's dev server happened to be down while testing
  // POST /filters/sync — fetch() itself throws for connection-level failures (refused/unreachable host),
  // not a rejected-but-received HTTP response, so this surfaced as an uncaught 500 instead of a clean 502.
  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the filters service responds with a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 503, body: {} });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response body has no "categories" array', async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a category is missing categoryKey or metrics", async () => {
    mockFetchOnce({ ok: true, body: { categories: [{ metrics: [] }] } });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  // Regression: caught live (2026-09-09) that a category could be missing categoryDisplayName right after
  // analysis-ts added it — must fail loudly rather than silently falling back to a placeholder, so a
  // partial rollout on their side surfaces immediately instead of quietly showing raw keys to users.
  it("throws a 502 AppError when a category is missing categoryDisplayName", async () => {
    mockFetchOnce({ ok: true, body: { categories: [{ categoryKey: "profitability", metrics: [] }] } });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a metric is missing metricCode or validTokens", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          { categoryKey: "profitability", categoryDisplayName: "獲利能力", metrics: [{ metricCode: "roe", name: "ROE", unit: "%" }] },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a metric is missing name or unit", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [{ categoryKey: "profitability", categoryDisplayName: "獲利能力", metrics: [{ metricCode: "roe", validTimeframes: ["TTM"] }] }],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  // Regression coverage for hasProvenance (analysis-ts, 2026-09-13) — present (true or false) on every
  // metric, not a "not every metric has one yet" field like formulaLatex/referenceUrl/badge, so missing
  // it entirely fails the whole sync rather than defaulting to false.
  it("throws a 502 AppError when a metric is missing hasProvenance", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", name: "ROE", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"] }],
          },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("passes through hasProvenance: true and hasProvenance: false correctly", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              { metricCode: "roe", name: "ROE", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1 },
              { metricCode: "roa", name: "ROA", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: false, formulaVersion: 1 },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

    expect(result[0]?.metrics.map((m) => ({ key: m.key, hasProvenance: m.hasProvenance }))).toEqual([
      { key: "roe", hasProvenance: true },
      { key: "roa", hasProvenance: false },
    ]);
  });

  // formulaVersion (analysis-ts 5785a6d2, 2026-09-22): a required integer on every metric — the same value
  // stamped on metric_values rows, used by web-nuxt as a "formula changed, re-read the copy" signal. Real
  // values that day: sue 3, the period-average-denominator batch 2, everything else 1.
  it("passes formulaVersion through as-is (not coerced to 1)", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "growth",
            categoryDisplayName: "成長動能",
            metrics: [
              { metricCode: "sue", name: "SUE", unit: "", validTimeframes: ["Q"], sources: ["公開發行公司損益表（XBRL）"], hasProvenance: true, formulaVersion: 3 },
              { metricCode: "roe", name: "ROE", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 2 },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

    expect(result[0]?.metrics.map((m) => [m.key, m.formulaVersion])).toEqual([["sue", 3], ["roe", 2]]);
  });

  it.each([
    ["missing", undefined],
    ["non-integer", 1.5],
    ["a string", "2"],
  ])("throws a 502 AppError when formulaVersion is %s", async (_label, value) => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", name: "ROE", unit: "%", validTimeframes: ["TTM"], sources: ["x"], hasProvenance: true, formulaVersion: value }],
          },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
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
                name: "股東權益報酬率 (ROE)",
                unit: "%",
                validTimeframes: ["TTM"],
                formulaLatex: "\\mathrm{ROE} = \\frac{\\mathrm{NetIncome}}{\\mathrm{Equity}} \\times 100",
                sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1,
              },
              { metricCode: "roa", name: "資產報酬率 (ROA)", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1 },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

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
            metrics: [{ metricCode: "roe", name: "ROE", unit: "%", validTimeframes: ["TTM"], formulaLatex: 123 }],
          },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  // description/limitations/misreadings (2026-09-19): description already existed on MetricDefinition
  // but was hardcoded to null here until analysis-ts actually started sending it this same day, alongside
  // the two genuinely new fields — same absent-entirely-until-documented convention as formulaLatex.
  it("passes through description/limitations/misreadings when present, and defaults to null when absent", async () => {
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
                name: "股東權益報酬率 (ROE)",
                unit: "%",
                validTimeframes: ["TTM"],
                description: "衡量股東投入資本的獲利效率。",
                limitations: "不反映槓桿程度，高 ROE 可能來自高負債而非高獲利能力。",
                misreadings: "不能只看單期數字，需搭配趨勢與同業比較。",
                sources: ["公開發行公司資產負債表（XBRL）"],
                hasProvenance: true, formulaVersion: 1,
              },
              { metricCode: "roa", name: "資產報酬率 (ROA)", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1 },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

    expect(result[0]?.metrics[0]?.description).toBe("衡量股東投入資本的獲利效率。");
    expect(result[0]?.metrics[0]?.limitations).toBe("不反映槓桿程度，高 ROE 可能來自高負債而非高獲利能力。");
    expect(result[0]?.metrics[0]?.misreadings).toBe("不能只看單期數字，需搭配趨勢與同業比較。");
    expect(result[0]?.metrics[1]?.description).toBeNull();
    expect(result[0]?.metrics[1]?.limitations).toBeNull();
    expect(result[0]?.metrics[1]?.misreadings).toBeNull();
  });

  it("throws a 502 AppError when limitations is present but not a string", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", name: "ROE", unit: "%", validTimeframes: ["TTM"], limitations: 123 }],
          },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
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
                name: "盈餘發放率",
                unit: "%",
                validTimeframes: ["TTM"],
                referenceUrl: "https://en.wikipedia.org/wiki/Dividend_payout_ratio",
                sources: ["公開發行公司現金流量表（XBRL）"], hasProvenance: true, formulaVersion: 1,
              },
              { metricCode: "roa", name: "資產報酬率 (ROA)", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1 },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

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
            metrics: [{ metricCode: "roe", name: "ROE", unit: "%", validTimeframes: ["TTM"], referenceUrl: 123 }],
          },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
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
                name: "標準化未預期盈餘 (SUE)",
                unit: "",
                validTimeframes: ["Q"],
                academicSourceUrl: "https://doi.org/10.2307/2491062",
                sources: ["公開發行公司損益表（XBRL）"], hasProvenance: true, formulaVersion: 1,
              },
              { metricCode: "roa", name: "資產報酬率 (ROA)", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1 },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

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
            metrics: [{ metricCode: "roe", name: "ROE", unit: "%", validTimeframes: ["TTM"], academicSourceUrl: 123 }],
          },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  // badge (2026-09-10, same rollout wave): the "guru badge" methodology object, moved from web-nuxt's own
  // hardcoded GURU_BADGES table into analysis-ts's MetricDefinitionSpec. Present only on the ~11 metrics
  // that table covered (Piotroski excluded by mutual agreement) — absent entirely elsewhere, resolves to null.
  const SAMPLE_BADGE = {
    name: "Graham Number",
    nameEn: "Graham Number",
    author: "Benjamin Graham",
    summary: "summary",
    detail: "detail",
    timeframe: "TTM",
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
                name: "Graham Number",
                unit: "元",
                validTimeframes: ["TTM"],
                badge: SAMPLE_BADGE,
                sources: ["公開發行公司資產負債表（XBRL）", "公開發行公司損益表（XBRL）"], hasProvenance: true, formulaVersion: 1,
              },
              { metricCode: "roa", name: "資產報酬率 (ROA)", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1 },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

    expect(result[0]?.metrics[0]?.badge).toEqual(SAMPLE_BADGE);
    expect(result[0]?.metrics[1]?.badge).toBeNull();
  });

  it("passes through a badge threshold using allPositiveFieldIds instead of comparator/value, with timeframe entirely absent (eps's real shape)", async () => {
    const { timeframe: _timeframe, ...badgeWithoutTimeframe } = SAMPLE_BADGE;
    const epsBadge = {
      ...badgeWithoutTimeframe,
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
                name: "EPS",
                unit: "元",
                validTimeframes: ["TTM", "Q"],
                badge: epsBadge,
                sources: ["公開發行公司損益表（XBRL）"], hasProvenance: true, formulaVersion: 1,
              },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

    expect(result[0]?.metrics[0]?.badge?.threshold.allPositiveFieldIds).toEqual(["eps.TTM", "eps.Q"]);
    expect(result[0]?.metrics[0]?.badge?.timeframe).toBeUndefined();
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
                name: "Graham Number",
                unit: "元",
                validTimeframes: ["TTM"],
                badge: { ...SAMPLE_BADGE, threshold: { description: "missing denominator" } },
              },
            ],
          },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
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
                name: "Graham Number",
                unit: "元",
                validTimeframes: ["TTM"],
                badge: { ...SAMPLE_BADGE, threshold: { ...SAMPLE_BADGE.threshold, comparator: "eq" } },
              },
            ],
          },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
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
                name: "盈餘發放率",
                unit: "%",
                validTimeframes: ["TTM"],
                sources: ["公開發行公司現金流量表（XBRL）"], hasProvenance: true, formulaVersion: 1,
                badge: {
                  ...SAMPLE_BADGE,
                  threshold: { description: "40%-60%", denominator: 1, comparator: "in_range" as const, valueMin: 40, valueMax: 60 },
                },
              },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

    expect(result[0]?.metrics[0]?.badge?.threshold).toMatchObject({ comparator: "in_range", valueMin: 40, valueMax: 60 });
  });

  // Regression (2026-09-20): a real sync outage. piotroskiFScore's badge.threshold gained a nested
  // `warning` threshold with (a) comparator "lte", not in the previously-hardcoded allowlist, and
  // (b) no `denominator` at all (inherits the parent's rather than repeating it) — both together made
  // isRawBadgeThreshold reject the whole category array, failing the entire sync, not just this one badge.
  it("passes through a nested threshold.warning using comparator 'lte' with no denominator of its own", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "resilience",
            categoryDisplayName: "財務韌性",
            metrics: [
              {
                metricCode: "piotroskiFScore",
                name: "Piotroski F-Score",
                unit: "分",
                validTimeframes: ["Q"],
                sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1,
                badge: {
                  ...SAMPLE_BADGE,
                  threshold: {
                    description: "≥ 8",
                    denominator: 9,
                    comparator: "gte" as const,
                    value: 8,
                    warning: { description: "≤ 2", comparator: "lte" as const, value: 2 },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

    expect(result[0]?.metrics[0]?.badge?.threshold?.warning).toEqual({ description: "≤ 2", comparator: "lte", value: 2 });
  });

  // percentileRank (2026-09-21): a cross-sectional ranking threshold shape, alternative to the fixed-value
  // comparator/value fields — mutually exclusive with them per analysis-ts, but not enforced by this
  // client (passed through as given either way). First metric: novyMarxGpToAssets.
  it("passes through a threshold's percentileRank sub-object", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "growth",
            categoryDisplayName: "成長動能",
            metrics: [
              {
                metricCode: "novyMarxGpToAssets",
                name: "毛利資產比五分位",
                unit: "分位",
                validTimeframes: ["TTM"],
                sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1,
                badge: {
                  ...SAMPLE_BADGE,
                  author: "Robert Novy-Marx",
                  threshold: {
                    description: "全市場前 20%",
                    percentileRank: { scope: "market" as const, direction: "desc" as const, topPercent: 20 },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

    expect(result[0]?.metrics[0]?.badge?.threshold?.percentileRank).toEqual({
      scope: "market",
      direction: "desc",
      topPercent: 20,
    });
  });

  it("throws a 502 AppError when threshold.percentileRank.scope is not 'market' or 'sector'", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "growth",
            categoryDisplayName: "成長動能",
            metrics: [
              {
                metricCode: "novyMarxGpToAssets",
                name: "毛利資產比五分位",
                unit: "分位",
                validTimeframes: ["TTM"],
                badge: {
                  ...SAMPLE_BADGE,
                  threshold: {
                    description: "全市場前 20%",
                    percentileRank: { scope: "industry", direction: "desc", topPercent: 20 },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
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
                name: "ROE",
                unit: "%",
                validTimeframes: ["TTM"],
                sources: ["公開發行公司資產負債表（XBRL）", "公開發行公司損益表（XBRL）"], hasProvenance: true, formulaVersion: 1,
              },
            ],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

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
            metrics: [{ metricCode: "roe", name: "ROE", unit: "%", validTimeframes: ["TTM"] }],
          },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when sources is present but not an array of strings", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", name: "ROE", unit: "%", validTimeframes: ["TTM"], sources: [123], hasProvenance: true, formulaVersion: 1 }],
          },
        ],
      },
    });

    await expect(fetchMetricCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("handles an empty validTokens array (zero queryable fields for that metric)", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", name: "ROE", unit: "%", validTimeframes: [], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: true, formulaVersion: 1 }],
          },
        ],
      },
    });

    const result = await fetchMetricCatalog();

    expect(result[0]?.metrics[0]?.fields).toEqual([]);
  });
});

/**
 * 2026-09-26 上游（commit 747feb18）在 metric 層級加了 `nameEn`（英文縮寫），起因是使用者要求「指標要有
 * ROIC」，決定的做法是 `name` 維持中文、縮寫放 `nameEn`。
 *
 * 這個 normalizer 是**逐欄位**的，所以沒手動接就會被靜默丟掉——dividendHistory 與 formulaVersion 都是這樣
 * 漏掉的。這裡兩個方向都釘住：有帶要穿過去、沒帶要是 null 而不是讓整份型錄同步失敗。
 */
describe("fetchMetricCatalog 的 nameEn", () => {
  it("上游帶的英文縮寫會穿過 normalizer", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              { metricCode: "roic", name: "投入資本報酬率", nameEn: "ROIC", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: false, formulaVersion: 1 },
            ],
          },
        ],
      },
    });

    const metric = (await fetchMetricCatalog())[0]?.metrics[0];

    expect(metric?.nameEn).toBe("ROIC");
    // name 不得被縮寫取代——中文名稱才是主標，nameEn 只給搜尋與副標用。
    expect(metric?.name).toBe("投入資本報酬率");
  });

  /**
   * 沒有縮寫的指標要是 null，而且**不能讓整份同步失敗**。把選填欄位當必填曾經真的炸過一次整份型錄
   * （badge.threshold 那次，2026-09-20），代價是全站的篩選 UI 都空掉，所以這一條是那次的迴歸測試。
   */
  it("上游沒帶 nameEn 時是 null，其他指標照樣同步成功", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [
              { metricCode: "roic", name: "投入資本報酬率", nameEn: "ROIC", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: false, formulaVersion: 1 },
              { metricCode: "somethingNew", name: "還沒有縮寫的指標", unit: "%", validTimeframes: ["TTM"], sources: ["公開發行公司資產負債表（XBRL）"], hasProvenance: false, formulaVersion: 1 },
            ],
          },
        ],
      },
    });

    const metrics = (await fetchMetricCatalog())[0]?.metrics ?? [];

    expect(metrics).toHaveLength(2);
    expect(metrics[0]?.nameEn).toBe("ROIC");
    expect(metrics[1]?.nameEn).toBeNull();
    // 欄位要存在（值是 null），不是整個鍵消失——下游用 "nameEn" in metric 判斷會被騙。
    expect(metrics[1]).toHaveProperty("nameEn");
  });
});

