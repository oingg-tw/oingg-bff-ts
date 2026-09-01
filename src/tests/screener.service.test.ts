import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/screener/analysisScreenerClient.js", () => ({
  fetchScreenerResults: vi.fn(),
  fetchScreenerRanking: vi.fn(),
}));

vi.mock("../domains/filterCatalog/index.js", () => ({
  findFilterFields: vi.fn(),
}));

vi.mock("../domains/stock/index.js", () => ({
  getLatestClosePrices: vi.fn(),
}));

vi.mock("../domains/companies/index.js", () => ({
  getCompanyNames: vi.fn(),
}));

vi.mock("../domains/screener/valuationRanking.client.js", () => ({
  fetchValuationRanking: vi.fn(),
}));

import { fetchScreenerRanking, fetchScreenerResults } from "../domains/screener/analysisScreenerClient.js";
import { findFilterFields } from "../domains/filterCatalog/index.js";
import { getLatestClosePrices } from "../domains/stock/index.js";
import { getCompanyNames } from "../domains/companies/index.js";
import { fetchValuationRanking } from "../domains/screener/valuationRanking.client.js";
import { runRanking, runScreener } from "../domains/screener/screener.service.js";
import type { Pagination } from "../domains/screener/pagination.js";

const DEFAULT_PAGINATION: Pagination = { page: 1, pageSize: 50 };

type Lookup = Awaited<ReturnType<typeof findFilterFields>>[number];

const KNOWN_FIELDS: Record<string, Lookup> = {
  "grossMargin.grossMarginTtm": {
    categoryKey: "profitability",
    metricKey: "grossMargin",
    metricName: "Margins",
    fieldKey: "grossMarginTtm",
    fieldName: "Gross Margin (TTM)",
    period: "ttm",
  },
  "roe.roeTtmPct": {
    categoryKey: "profitability",
    metricKey: "roe",
    metricName: "ROE",
    fieldKey: "roeTtmPct",
    fieldName: "ROE (TTM)",
    period: "ttm",
  },
  "per.peRatio": {
    categoryKey: "valuation",
    metricKey: "per",
    metricName: "本益比 PER",
    fieldKey: "peRatio",
    fieldName: "本益比 PER",
    period: "daily",
  },
};

beforeEach(() => {
  vi.mocked(fetchScreenerResults).mockReset();
  vi.mocked(fetchScreenerRanking).mockReset();
  vi.mocked(findFilterFields).mockReset();
  vi.mocked(findFilterFields).mockImplementation(async (refs) =>
    refs
      .map((ref) => KNOWN_FIELDS[`${ref.metricKey}.${ref.fieldKey}`] ?? null)
      .filter((f): f is Lookup => f !== null),
  );
  vi.mocked(getLatestClosePrices).mockReset();
  vi.mocked(getCompanyNames).mockReset();
  vi.mocked(getCompanyNames).mockResolvedValue(new Map());
  vi.mocked(fetchValuationRanking).mockReset();
});

describe("runScreener", () => {
  it("rejects an empty filters array", async () => {
    await expect(runScreener([], [], DEFAULT_PAGINATION)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchScreenerResults).not.toHaveBeenCalled();
  });

  it("rejects a filter field that doesn't exist in the filter catalog, without calling analysis-ts", async () => {
    await expect(
      runScreener([{ field: "nope.nope", min: 1, max: null, exclude: false }], [], DEFAULT_PAGINATION),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchScreenerResults).not.toHaveBeenCalled();
  });

  // Regression coverage for the direct-DB anti-pattern fix (2026-09-01): the general screener query now
  // runs on analysis-ts's own POST /screener (see analysisScreenerClient.ts), which covers the entire
  // /filters catalog by construction — there is no "metric isn't wired up yet" 501 case left on bff-ts's
  // side. A field that exists in the catalog always delegates through.
  it("delegates the filters/columns/pagination straight to fetchScreenerResults", async () => {
    vi.mocked(fetchScreenerResults).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

    await runScreener(
      [
        { field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false },
        { field: "roe.roeTtmPct", min: null, max: 30, exclude: false },
      ],
      [{ field: "roe.roeTtmPct" }],
      { page: 2, pageSize: 25 },
    );

    expect(fetchScreenerResults).toHaveBeenCalledWith(
      [
        { field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false },
        { field: "roe.roeTtmPct", min: null, max: 30, exclude: false },
      ],
      [{ field: "roe.roeTtmPct" }],
      { page: 2, pageSize: 25 },
    );
  });

  it("resolves the requested columns against the local filter catalog for metricName/fieldName in the response", async () => {
    vi.mocked(fetchScreenerResults).mockResolvedValue({
      count: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      results: [{ symbol: "2330", values: { "roe.roeTtmPct": { value: "10.98", asOfDate: "26Q2" } } }],
    });

    const result = await runScreener(
      [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
      [{ field: "roe.roeTtmPct" }],
      DEFAULT_PAGINATION,
    );

    expect(result.columns).toEqual([{ field: "roe.roeTtmPct", metricName: "ROE", fieldName: "ROE (TTM)" }]);
    expect(result.results).toEqual([
      { symbol: "2330", name: null, values: { "roe.roeTtmPct": { value: "10.98", asOfDate: "26Q2" } } },
    ]);
  });

  it('merges in "stock.price" (a special, non-catalog column) from twse/tpex, not passed through to analysis-ts', async () => {
    vi.mocked(fetchScreenerResults).mockResolvedValue({
      count: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      results: [
        { symbol: "2330", values: {} },
        { symbol: "2317", values: {} },
      ],
    });
    vi.mocked(getLatestClosePrices).mockResolvedValue(
      new Map([["2330", { close: "2350.0000", tradeDate: "2026-08-28" }]]),
    );

    const result = await runScreener(
      [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
      [{ field: "stock.price" }],
      DEFAULT_PAGINATION,
    );

    // "stock.price" must never leak into the columns sent to analysis-ts — it isn't a filterCatalog field.
    expect(fetchScreenerResults).toHaveBeenCalledWith(expect.anything(), [], DEFAULT_PAGINATION);
    // One batched call for the whole result set, not one call per symbol.
    expect(getLatestClosePrices).toHaveBeenCalledTimes(1);
    expect(getLatestClosePrices).toHaveBeenCalledWith(["2330", "2317"]);
    expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價" });
    expect(result.results).toEqual([
      { symbol: "2330", name: null, values: { "stock.price": { value: "2350.0000", asOfDate: "2026-08-28" } } },
      { symbol: "2317", name: null, values: { "stock.price": { value: null, asOfDate: null } } },
    ]);
  });

  // Company names are always attached, regardless of which columns were requested — not gated behind an
  // opt-in column the way stock.price is. See companies.service.ts: this is a live per-request lookup,
  // nothing cached on bff's side.
  it("attaches each row's company name from a single batched getCompanyNames lookup", async () => {
    vi.mocked(fetchScreenerResults).mockResolvedValue({
      count: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      results: [
        { symbol: "2330", values: {} },
        { symbol: "2317", values: {} },
      ],
    });
    vi.mocked(getCompanyNames).mockResolvedValue(
      new Map([
        ["2330", "台積電"],
        ["2317", null],
      ]),
    );

    const result = await runScreener(
      [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
      [],
      DEFAULT_PAGINATION,
    );

    expect(getCompanyNames).toHaveBeenCalledTimes(1);
    expect(getCompanyNames).toHaveBeenCalledWith(["2330", "2317"]);
    expect(result.results).toEqual([
      { symbol: "2330", name: "台積電", values: {} },
      { symbol: "2317", name: null, values: {} },
    ]);
  });

  // Regression test: filters and display columns used to each be resolved against the filter catalog
  // one at a time (one query per field). Must be a single batched lookup covering both.
  it("resolves all filter and column fields in a single batched catalog lookup", async () => {
    vi.mocked(fetchScreenerResults).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

    await runScreener(
      [
        { field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false },
        { field: "roe.roeTtmPct", min: null, max: 30, exclude: false },
      ],
      [{ field: "roe.roeTtmPct" }],
      DEFAULT_PAGINATION,
    );

    expect(findFilterFields).toHaveBeenCalledTimes(1);
    expect(findFilterFields).toHaveBeenCalledWith([
      { field: "grossMargin.grossMarginTtm", metricKey: "grossMargin", fieldKey: "grossMarginTtm" },
      { field: "roe.roeTtmPct", metricKey: "roe", fieldKey: "roeTtmPct" },
      { field: "roe.roeTtmPct", metricKey: "roe", fieldKey: "roeTtmPct" },
    ]);
  });

  describe("pagination", () => {
    it("passes count/page/pageSize/totalPages straight through from analysis-ts", async () => {
      vi.mocked(fetchScreenerResults).mockResolvedValue({
        count: 120,
        page: 3,
        pageSize: 2,
        totalPages: 60,
        results: [
          { symbol: "2330", values: {} },
          { symbol: "2317", values: {} },
        ],
      });

      const result = await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [],
        { page: 3, pageSize: 2 },
      );

      expect(result.count).toBe(120);
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(2);
      expect(result.totalPages).toBe(60);
    });

    it("reports count 0 and totalPages 0 when nothing matches", async () => {
      vi.mocked(fetchScreenerResults).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

      const result = await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [],
        { page: 1, pageSize: 50 },
      );

      expect(result.count).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(result.results).toEqual([]);
    });
  });
});

describe("runRanking", () => {
  it("delegates field/direction/limit and extra columns to fetchScreenerRanking", async () => {
    vi.mocked(fetchScreenerRanking).mockResolvedValue({ results: [] });

    await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "grossMargin.grossMarginTtm" }]);

    expect(fetchScreenerRanking).toHaveBeenCalledWith("roe.roeTtmPct", "desc", 10, [
      { field: "grossMargin.grossMarginTtm" },
    ]);
  });

  it("resolves the ranked field and extra columns against the local catalog for the response's columns", async () => {
    vi.mocked(fetchScreenerRanking).mockResolvedValue({
      results: [
        { symbol: "2330", values: { "roe.roeTtmPct": { value: "30.5", asOfDate: "26Q2" } } },
        { symbol: "2317", values: { "roe.roeTtmPct": { value: "25.1", asOfDate: "26Q1" } } },
      ],
    });

    const result = await runRanking("roe.roeTtmPct", "desc", 10, []);

    expect(result.field).toBe("roe.roeTtmPct");
    expect(result.direction).toBe("desc");
    expect(result.columns).toEqual([{ field: "roe.roeTtmPct", metricName: "ROE", fieldName: "ROE (TTM)" }]);
    // Different symbols can legitimately have different asOfDate for the same field (one filed later).
    expect(result.results).toEqual([
      { symbol: "2330", name: null, values: { "roe.roeTtmPct": { value: "30.5", asOfDate: "26Q2" } } },
      { symbol: "2317", name: null, values: { "roe.roeTtmPct": { value: "25.1", asOfDate: "26Q1" } } },
    ]);
  });

  it("rejects a field the filter catalog doesn't know about, without calling analysis-ts", async () => {
    await expect(runRanking("nope.nope", "desc", 10, [])).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchScreenerRanking).not.toHaveBeenCalled();
  });

  it("doesn't re-resolve or re-pass the ranked field as an extra column when it's also listed in columns", async () => {
    vi.mocked(fetchScreenerRanking).mockResolvedValue({ results: [] });

    await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "roe.roeTtmPct" }, { field: "grossMargin.grossMarginTtm" }]);

    expect(fetchScreenerRanking).toHaveBeenCalledWith("roe.roeTtmPct", "desc", 10, [
      { field: "grossMargin.grossMarginTtm" },
    ]);
  });

  it("adds extra display columns to the response's columns array", async () => {
    vi.mocked(fetchScreenerRanking).mockResolvedValue({
      results: [
        {
          symbol: "2330",
          values: {
            "roe.roeTtmPct": { value: "30.5", asOfDate: "26Q2" },
            "grossMargin.grossMarginTtm": { value: "55.2", asOfDate: "26Q2" },
          },
        },
      ],
    });

    const result = await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "grossMargin.grossMarginTtm" }]);

    expect(result.columns).toContainEqual({
      field: "grossMargin.grossMarginTtm",
      metricName: "Margins",
      fieldName: "Gross Margin (TTM)",
    });
    expect(result.results[0]?.values).toMatchObject({
      "grossMargin.grossMarginTtm": { value: "55.2", asOfDate: "26Q2" },
    });
  });

  it('merges "stock.price" into results the same way runScreener does', async () => {
    vi.mocked(fetchScreenerRanking).mockResolvedValue({
      results: [{ symbol: "2330", values: { "roe.roeTtmPct": { value: "30.5", asOfDate: "26Q2" } } }],
    });
    vi.mocked(getLatestClosePrices).mockResolvedValue(
      new Map([["2330", { close: "2410.0000", tradeDate: "2026-08-28" }]]),
    );

    const result = await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "stock.price" }]);

    // "stock.price" must never be sent to analysis-ts as an extra column — it isn't a filterCatalog field.
    expect(fetchScreenerRanking).toHaveBeenCalledWith("roe.roeTtmPct", "desc", 10, []);
    expect(getLatestClosePrices).toHaveBeenCalledWith(["2330"]);
    expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價" });
    expect(result.results[0]?.values).toMatchObject({
      "stock.price": { value: "2410.0000", asOfDate: "2026-08-28" },
    });
  });

  it("returns exactly what fetchScreenerRanking gives back, no pagination metadata on the result", async () => {
    vi.mocked(fetchScreenerRanking).mockResolvedValue({ results: [] });

    const result = await runRanking("roe.roeTtmPct", "desc", 3, []);

    expect(result).not.toHaveProperty("count");
    expect(result).not.toHaveProperty("page");
  });

  // Regression coverage: per.peRatio/pbr.pbRatio/dividendYield.dividendYieldPct must bypass the general
  // screener path entirely and delegate to oingg-analysis-ts's own GET /valuation/ranking (via
  // fetchValuationRanking) instead — ranking is a second-order computation over raw market data (merge
  // twse+tpex, exclude non-positive P/E or P/B, sort) that belongs to analysis-ts's dedicated endpoint,
  // not the general screener query. See VALUATION_RANKING_FIELDS and runValuationRanking.
  describe("valuation field override (per/pbr/dividendYield -> oingg-analysis-ts's ranking endpoint)", () => {
    it("routes per.peRatio to fetchValuationRanking instead of the general screener ranking path", async () => {
      vi.mocked(fetchValuationRanking).mockResolvedValue({
        tradeDate: "2026-08-28",
        rankings: [
          { symbol: "1240", value: 10.61 },
          { symbol: "2330", value: 27.82 },
        ],
      });

      const result = await runRanking("per.peRatio", "asc", 10, []);

      expect(fetchValuationRanking).toHaveBeenCalledWith("peRatio", "asc", 10);
      expect(fetchScreenerRanking).not.toHaveBeenCalled();
      expect(result).toEqual({
        field: "per.peRatio",
        direction: "asc",
        columns: [{ field: "per.peRatio", metricName: "本益比 PER", fieldName: "本益比 PER" }],
        results: [
          { symbol: "1240", name: null, values: { "per.peRatio": { value: "10.61", asOfDate: "2026-08-28" } } },
          { symbol: "2330", name: null, values: { "per.peRatio": { value: "27.82", asOfDate: "2026-08-28" } } },
        ],
      });
    });

    it("still merges stock.price in when requested alongside a valuation ranking", async () => {
      vi.mocked(fetchValuationRanking).mockResolvedValue({
        tradeDate: "2026-08-28",
        rankings: [{ symbol: "2330", value: 27.82 }],
      });
      vi.mocked(getLatestClosePrices).mockResolvedValue(
        new Map([["2330", { close: "2420.0000", tradeDate: "2026-08-28" }]]),
      );

      const result = await runRanking("per.peRatio", "asc", 10, [{ field: "stock.price" }]);

      expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價" });
      expect(result.results[0]?.values).toMatchObject({
        "stock.price": { value: "2420.0000", asOfDate: "2026-08-28" },
      });
    });

    it("rejects combining a valuation ranking with any column other than stock.price", async () => {
      await expect(runRanking("per.peRatio", "asc", 10, [{ field: "roe.roeTtmPct" }])).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(fetchValuationRanking).not.toHaveBeenCalled();
    });
  });
});
