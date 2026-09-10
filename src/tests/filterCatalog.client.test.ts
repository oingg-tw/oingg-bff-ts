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
    metrics: [{ metricCode: "roe", displayName: "股東權益報酬率 (ROE)", unit: "%", validTokens: ["Q", "Q_ANN", "TTM"] }],
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
              },
              { metricCode: "roa", displayName: "資產報酬率 (ROA)", unit: "%", validTokens: ["TTM"] },
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

  it("handles an empty validTokens array (zero queryable fields for that metric)", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "profitability",
            categoryDisplayName: "獲利能力",
            metrics: [{ metricCode: "roe", displayName: "ROE", unit: "%", validTokens: [] }],
          },
        ],
      },
    });

    const result = await fetchFilterCatalog();

    expect(result[0]?.metrics[0]?.fields).toEqual([]);
  });
});
