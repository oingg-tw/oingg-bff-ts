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

// Real shape given directly by analysis-ts after their 2026-09-08 pitMetrics rebuild — no display copy
// (no name/description/source/unit anywhere), one "field" per allowedBases entry instead of a named
// sub-array.
const RAW_CATEGORIES = [
  { categoryKey: "profitability", metrics: [{ metricCode: "roe", allowedBases: ["Q", "Q_ANN", "TTM"] }] },
];

describe("fetchFilterCatalog", () => {
  it("requests /filters and converts the pitMetrics shape into FilterCategory[]", async () => {
    mockFetchOnce({ ok: true, body: { categories: RAW_CATEGORIES } });

    const result = await fetchFilterCatalog();

    expect(result).toEqual([
      {
        key: "profitability",
        name: "profitability",
        sort: 0,
        metrics: [
          {
            key: "roe",
            name: "roe",
            path: "roe",
            description: null,
            source: null,
            unit: null,
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
    expect(calledUrl.toString()).toBe("http://filters.test/filters");
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

  it("throws a 502 AppError when a metric is missing metricCode or allowedBases", async () => {
    mockFetchOnce({ ok: true, body: { categories: [{ categoryKey: "profitability", metrics: [{ metricCode: "roe" }] }] } });

    await expect(fetchFilterCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("handles an empty allowedBases array (zero queryable fields for that metric)", async () => {
    mockFetchOnce({
      ok: true,
      body: { categories: [{ categoryKey: "profitability", metrics: [{ metricCode: "roe", allowedBases: [] }] }] },
    });

    const result = await fetchFilterCatalog();

    expect(result[0]?.metrics[0]?.fields).toEqual([]);
  });
});
