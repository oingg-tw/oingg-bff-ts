import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/analysisApi/screener/analysisScreenerClient.js", () => ({
  fetchScreenerResults: vi.fn(),
  fetchScreenerRanking: vi.fn(),
  fetchScreenerValues: vi.fn(),
  fetchCompanyRank: vi.fn(),
}));

vi.mock("@/infrastructure/prisma/repositories/metricCatalog.repository.js", () => ({
  findMetricFields: vi.fn(),
}));

vi.mock("@/application/proxy/stock/index.js", () => ({
  getLatestClosePrices: vi.fn(),
}));

vi.mock("@/infrastructure/analysisApi/screener/valuationRanking.client.js", () => ({
  fetchValuationRanking: vi.fn(),
}));

import { fetchCompanyRank, fetchScreenerRanking, fetchScreenerResults, fetchScreenerValues } from "@/infrastructure/analysisApi/screener/analysisScreenerClient.js";
import { findMetricFields } from "@/infrastructure/prisma/repositories/metricCatalog.repository.js";
import { getLatestClosePrices } from "@/application/proxy/stock/index.js";
import { fetchValuationRanking } from "@/infrastructure/analysisApi/screener/valuationRanking.client.js";
import { runCompanyRank, runRanking, runScreener, runScreenerValues } from "@/application/proxy/screener/screener.service.js";
import type { Pagination } from "@/application/proxy/screener/pagination.js";

const DEFAULT_PAGINATION: Pagination = { page: 1, pageSize: 50 };

type Lookup = Awaited<ReturnType<typeof findMetricFields>>[number];

const KNOWN_FIELDS: Record<string, Lookup> = {
  "grossMargin.grossMarginTtm": {
    categoryKey: "profitability",
    metricKey: "grossMargin",
    metricName: "Margins",
    fieldKey: "grossMarginTtm",
    fieldName: "Gross Margin (TTM)",
    period: "ttm",
    unit: "percent",
  },
  "roe.roeTtmPct": {
    categoryKey: "profitability",
    metricKey: "roe",
    metricName: "ROE",
    fieldKey: "roeTtmPct",
    fieldName: "ROE (TTM)",
    period: "ttm",
    unit: "percent",
  },
  "per.peRatio": {
    categoryKey: "valuation",
    metricKey: "per",
    metricName: "本益比 PER",
    fieldKey: "peRatio",
    fieldName: "本益比 PER",
    period: "daily",
    unit: "times",
  },
  // pitMetrics-era addressing (2026-09-08) for the same "current TWSE daily market P/E" concept —
  // see VALUATION_RANKING_FIELDS in screener.service.ts.
  "exchangePeRatio.EOD": {
    categoryKey: "valuation",
    metricKey: "exchangePeRatio",
    metricName: "exchangePeRatio",
    fieldKey: "EOD",
    fieldName: "EOD",
    period: "EOD",
    unit: null,
  },
};

beforeEach(() => {
  vi.mocked(fetchScreenerResults).mockReset();
  vi.mocked(fetchScreenerRanking).mockReset();
  vi.mocked(fetchScreenerValues).mockReset();
  vi.mocked(findMetricFields).mockReset();
  vi.mocked(findMetricFields).mockImplementation(async (refs) =>
    refs
      .map((ref) => KNOWN_FIELDS[`${ref.metricKey}.${ref.fieldKey}`] ?? null)
      .filter((f): f is Lookup => f !== null),
  );
  vi.mocked(getLatestClosePrices).mockReset();
  vi.mocked(fetchValuationRanking).mockReset();
  vi.mocked(fetchCompanyRank).mockReset();
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
      undefined,
      undefined,
      undefined,
    );
  });

  describe("sort", () => {
    it('passes "symbol" through as a valid sortField even though it\'s not in columns', async () => {
      vi.mocked(fetchScreenerResults).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

      await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [],
        DEFAULT_PAGINATION,
        { field: "symbol", order: "desc" },
      );

      expect(fetchScreenerResults).toHaveBeenCalledWith(
        expect.anything(),
        [],
        DEFAULT_PAGINATION,
        { field: "symbol", order: "desc" },
        undefined,
        undefined,
      );
    });

    it("passes a sortField that is one of this request's own columns through to fetchScreenerResults", async () => {
      vi.mocked(fetchScreenerResults).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

      await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [{ field: "roe.roeTtmPct" }],
        DEFAULT_PAGINATION,
        { field: "roe.roeTtmPct", order: "asc" },
      );

      expect(fetchScreenerResults).toHaveBeenCalledWith(
        expect.anything(),
        [{ field: "roe.roeTtmPct" }],
        DEFAULT_PAGINATION,
        { field: "roe.roeTtmPct", order: "asc" },
        undefined,
        undefined,
      );
    });

    // The whole point of requiring sortField to be one of this request's own columns: a filter-only
    // field (used to narrow results but never displayed) shouldn't be sortable — the caller can't see
    // what it's sorting by.
    it("rejects a sortField that's a filter-only field, not requested as a display column", async () => {
      await expect(
        runScreener(
          [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
          [],
          DEFAULT_PAGINATION,
          { field: "grossMargin.grossMarginTtm", order: "asc" },
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(fetchScreenerResults).not.toHaveBeenCalled();
    });

    // "stock.price" isn't part of analysis-ts's data at all (twse/tpex, merged in by bff-ts after the
    // fact) — sorting the full result set by it isn't something analysis-ts's engine can do.
    it('rejects sorting by "stock.price"', async () => {
      await expect(
        runScreener(
          [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
          [{ field: "stock.price" }],
          DEFAULT_PAGINATION,
          { field: "stock.price", order: "asc" },
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(fetchScreenerResults).not.toHaveBeenCalled();
    });
  });

  it("resolves the requested columns against the local filter catalog for metricName/fieldName in the response", async () => {
    vi.mocked(fetchScreenerResults).mockResolvedValue({
      count: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      results: [{ symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "10.98", knowledgeDate: "26Q2", nullReason: null } } }],
    });

    const result = await runScreener(
      [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
      [{ field: "roe.roeTtmPct" }],
      DEFAULT_PAGINATION,
    );

    expect(result.columns).toEqual([{ field: "roe.roeTtmPct", metricName: "ROE", fieldName: "ROE (TTM)", unit: "percent" }]);
    expect(result.results).toEqual([
      { symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "10.98", knowledgeDate: "26Q2", nullReason: null } } },
    ]);
  });

  it('merges in "stock.price" (a special, non-catalog column) from twse/tpex, not passed through to analysis-ts', async () => {
    vi.mocked(fetchScreenerResults).mockResolvedValue({
      count: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      results: [
        { symbol: "2330", name: "台積電", values: {} },
        { symbol: "2317", name: "鴻海", values: {} },
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

    // "stock.price" must never leak into the columns sent to analysis-ts — it isn't a metricCatalog field.
    expect(fetchScreenerResults).toHaveBeenCalledWith(expect.anything(), [], DEFAULT_PAGINATION, undefined, undefined, undefined);
    // One batched call for the whole result set, not one call per symbol.
    expect(getLatestClosePrices).toHaveBeenCalledTimes(1);
    expect(getLatestClosePrices).toHaveBeenCalledWith(["2330", "2317"]);
    expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價", unit: "currency" });
    expect(result.results).toEqual([
      { symbol: "2330", name: "台積電", values: { "stock.price": { value: "2350.0000", knowledgeDate: "2026-08-28", nullReason: null } } },
      { symbol: "2317", name: "鴻海", values: { "stock.price": { value: null, knowledgeDate: null, nullReason: null } } },
    ]);
  });

  // analysis-ts attaches companyName directly on each row as of 2026-09-01 (see analysisScreenerClient.ts's
  // normalizeRows) — bff-ts no longer merges names in from a local cache, just passes the field through.
  it("passes each row's company name through directly from analysis-ts, without any local merge step", async () => {
    vi.mocked(fetchScreenerResults).mockResolvedValue({
      count: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      results: [
        { symbol: "2330", name: "台積電", values: {} },
        { symbol: "2317", name: null, values: {} },
      ],
    });

    const result = await runScreener(
      [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
      [],
      DEFAULT_PAGINATION,
    );

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

    expect(findMetricFields).toHaveBeenCalledTimes(1);
    expect(findMetricFields).toHaveBeenCalledWith([
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
          { symbol: "2330", name: null, values: {} },
          { symbol: "2317", name: null, values: {} },
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

    expect(fetchScreenerRanking).toHaveBeenCalledWith(
      "roe.roeTtmPct",
      "desc",
      10,
      [{ field: "grossMargin.grossMarginTtm" }],
      undefined,
      undefined,
    );
  });

  it("resolves the ranked field and extra columns against the local catalog for the response's columns", async () => {
    vi.mocked(fetchScreenerRanking).mockResolvedValue({
      results: [
        { symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "30.5", knowledgeDate: "26Q2", nullReason: null } } },
        { symbol: "2317", name: "鴻海", values: { "roe.roeTtmPct": { value: "25.1", knowledgeDate: "26Q1", nullReason: null } } },
      ],
    });

    const result = await runRanking("roe.roeTtmPct", "desc", 10, []);

    expect(result.field).toBe("roe.roeTtmPct");
    expect(result.direction).toBe("desc");
    expect(result.columns).toEqual([{ field: "roe.roeTtmPct", metricName: "ROE", fieldName: "ROE (TTM)", unit: "percent" }]);
    // Different symbols can legitimately have different knowledgeDate for the same field (one filed later).
    expect(result.results).toEqual([
      { symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "30.5", knowledgeDate: "26Q2", nullReason: null } } },
      { symbol: "2317", name: "鴻海", values: { "roe.roeTtmPct": { value: "25.1", knowledgeDate: "26Q1", nullReason: null } } },
    ]);
  });

  it("rejects a field the filter catalog doesn't know about, without calling analysis-ts", async () => {
    await expect(runRanking("nope.nope", "desc", 10, [])).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchScreenerRanking).not.toHaveBeenCalled();
  });

  it("doesn't re-resolve or re-pass the ranked field as an extra column when it's also listed in columns", async () => {
    vi.mocked(fetchScreenerRanking).mockResolvedValue({ results: [] });

    await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "roe.roeTtmPct" }, { field: "grossMargin.grossMarginTtm" }]);

    expect(fetchScreenerRanking).toHaveBeenCalledWith(
      "roe.roeTtmPct",
      "desc",
      10,
      [{ field: "grossMargin.grossMarginTtm" }],
      undefined,
      undefined,
    );
  });

  it("adds extra display columns to the response's columns array", async () => {
    vi.mocked(fetchScreenerRanking).mockResolvedValue({
      results: [
        {
          symbol: "2330",
          name: "台積電",
          values: {
            "roe.roeTtmPct": { value: "30.5", knowledgeDate: "26Q2", nullReason: null },
            "grossMargin.grossMarginTtm": { value: "55.2", knowledgeDate: "26Q2", nullReason: null },
          },
        },
      ],
    });

    const result = await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "grossMargin.grossMarginTtm" }]);

    expect(result.columns).toContainEqual({
      field: "grossMargin.grossMarginTtm",
      metricName: "Margins",
      fieldName: "Gross Margin (TTM)",
      unit: "percent",
    });
    expect(result.results[0]?.values).toMatchObject({
      "grossMargin.grossMarginTtm": { value: "55.2", knowledgeDate: "26Q2" },
    });
  });

  it('merges "stock.price" into results the same way runScreener does', async () => {
    vi.mocked(fetchScreenerRanking).mockResolvedValue({
      results: [{ symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "30.5", knowledgeDate: "26Q2", nullReason: null } } }],
    });
    vi.mocked(getLatestClosePrices).mockResolvedValue(
      new Map([["2330", { close: "2410.0000", tradeDate: "2026-08-28" }]]),
    );

    const result = await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "stock.price" }]);

    // "stock.price" must never be sent to analysis-ts as an extra column — it isn't a metricCatalog field.
    expect(fetchScreenerRanking).toHaveBeenCalledWith("roe.roeTtmPct", "desc", 10, [], undefined, undefined);
    expect(getLatestClosePrices).toHaveBeenCalledWith(["2330"]);
    expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價", unit: "currency" });
    expect(result.results[0]?.values).toMatchObject({
      "stock.price": { value: "2410.0000", knowledgeDate: "2026-08-28" },
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
    // Trigger keys updated 2026-09-08 for analysis-ts's pitMetrics rebuild — see VALUATION_RANKING_FIELDS.
    it("routes exchangePeRatio.EOD to fetchValuationRanking instead of the general screener ranking path", async () => {
      vi.mocked(fetchValuationRanking).mockResolvedValue({
        tradeDate: "2026-08-28",
        rankings: [
          { symbol: "1240", name: "撼訊", value: 10.61 },
          { symbol: "2330", name: "台積電", value: 27.82 },
        ],
      });

      const result = await runRanking("exchangePeRatio.EOD", "asc", 10, []);

      expect(fetchValuationRanking).toHaveBeenCalledWith("peRatio", "asc", 10);
      expect(fetchScreenerRanking).not.toHaveBeenCalled();
      expect(result).toEqual({
        field: "exchangePeRatio.EOD",
        direction: "asc",
        columns: [{ field: "exchangePeRatio.EOD", metricName: "exchangePeRatio", fieldName: "EOD", unit: null }],
        results: [
          { symbol: "1240", name: "撼訊", values: { "exchangePeRatio.EOD": { value: "10.61", knowledgeDate: "2026-08-28", nullReason: null } } },
          { symbol: "2330", name: "台積電", values: { "exchangePeRatio.EOD": { value: "27.82", knowledgeDate: "2026-08-28", nullReason: null } } },
        ],
      });
    });

    it("still merges stock.price in when requested alongside a valuation ranking", async () => {
      vi.mocked(fetchValuationRanking).mockResolvedValue({
        tradeDate: "2026-08-28",
        rankings: [{ symbol: "2330", name: "台積電", value: 27.82 }],
      });
      vi.mocked(getLatestClosePrices).mockResolvedValue(
        new Map([["2330", { close: "2420.0000", tradeDate: "2026-08-28" }]]),
      );

      const result = await runRanking("exchangePeRatio.EOD", "asc", 10, [{ field: "stock.price" }]);

      expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價", unit: "currency" });
      expect(result.results[0]?.values).toMatchObject({
        "stock.price": { value: "2420.0000", knowledgeDate: "2026-08-28" },
      });
    });

    it("rejects combining a valuation ranking with any column other than stock.price", async () => {
      await expect(runRanking("exchangePeRatio.EOD", "asc", 10, [{ field: "roe.roeTtmPct" }])).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(fetchValuationRanking).not.toHaveBeenCalled();
    });

    // The valuation ranking path is a separate analysis-ts endpoint with no filter concept at all — it
    // can't be given sectorCodes, unlike the general ranking path below.
    it("rejects sectorCodes on a valuation ranking (no sector-filter concept on that upstream endpoint)", async () => {
      await expect(runRanking("exchangePeRatio.EOD", "asc", 10, [], ["24"])).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(fetchValuationRanking).not.toHaveBeenCalled();
    });

    it("rejects excludeSectorCodes on a valuation ranking, same as sectorCodes", async () => {
      await expect(runRanking("exchangePeRatio.EOD", "asc", 10, [], undefined, ["24"])).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(fetchValuationRanking).not.toHaveBeenCalled();
    });
  });

  describe("sectorCodes", () => {
    it("forwards sectorCodes to fetchScreenerResults on the general screener path", async () => {
      vi.mocked(fetchScreenerResults).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

      await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [],
        DEFAULT_PAGINATION,
        undefined,
        ["24", "01"],
      );

      expect(fetchScreenerResults).toHaveBeenCalledWith(expect.anything(), [], DEFAULT_PAGINATION, undefined, ["24", "01"], undefined);
    });

    it("forwards sectorCodes to fetchScreenerRanking on the general ranking path", async () => {
      vi.mocked(fetchScreenerRanking).mockResolvedValue({ results: [] });

      await runRanking("roe.roeTtmPct", "desc", 10, [], ["24"]);

      expect(fetchScreenerRanking).toHaveBeenCalledWith("roe.roeTtmPct", "desc", 10, [], ["24"], undefined);
    });
  });

  describe("excludeSectorCodes", () => {
    it("forwards excludeSectorCodes to fetchScreenerResults on the general screener path", async () => {
      vi.mocked(fetchScreenerResults).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

      await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [],
        DEFAULT_PAGINATION,
        undefined,
        undefined,
        ["24", "01"],
      );

      expect(fetchScreenerResults).toHaveBeenCalledWith(expect.anything(), [], DEFAULT_PAGINATION, undefined, undefined, ["24", "01"]);
    });

    it("forwards excludeSectorCodes to fetchScreenerRanking on the general ranking path", async () => {
      vi.mocked(fetchScreenerRanking).mockResolvedValue({ results: [] });

      await runRanking("roe.roeTtmPct", "desc", 10, [], undefined, ["24"]);

      expect(fetchScreenerRanking).toHaveBeenCalledWith("roe.roeTtmPct", "desc", 10, [], undefined, ["24"]);
    });
  });
});

describe("runScreenerValues", () => {
  it("rejects an empty symbols array", async () => {
    await expect(runScreenerValues([], [{ field: "roe.roeTtmPct" }])).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchScreenerValues).not.toHaveBeenCalled();
  });

  it("rejects an empty columns array", async () => {
    await expect(runScreenerValues(["2330"], [])).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchScreenerValues).not.toHaveBeenCalled();
  });

  it("rejects more than 200 symbols in one request", async () => {
    const symbols = Array.from({ length: 201 }, (_, i) => String(i));
    await expect(runScreenerValues(symbols, [{ field: "roe.roeTtmPct" }])).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchScreenerValues).not.toHaveBeenCalled();
  });

  it("delegates symbols and resolved columns straight to fetchScreenerValues", async () => {
    vi.mocked(fetchScreenerValues).mockResolvedValue({ results: [] });

    await runScreenerValues(["2330", "2317"], [{ field: "roe.roeTtmPct" }]);

    expect(fetchScreenerValues).toHaveBeenCalledWith(["2330", "2317"], [{ field: "roe.roeTtmPct" }]);
  });

  // The core point of this endpoint: every requested symbol gets a row, even if analysis-ts has no data
  // for it — never silently drop a symbol the caller already has on screen.
  it("returns a row for every requested symbol, with empty values for one analysis-ts didn't return", async () => {
    vi.mocked(fetchScreenerValues).mockResolvedValue({
      results: [{ symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "34.78", knowledgeDate: "26Q2", nullReason: null } } }],
    });

    const result = await runScreenerValues(["2330", "9999"], [{ field: "roe.roeTtmPct" }]);

    expect(result.results).toEqual([
      { symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "34.78", knowledgeDate: "26Q2", nullReason: null } } },
      { symbol: "9999", name: null, values: {} },
    ]);
  });

  it("count always equals results.length (== the number of symbols requested)", async () => {
    vi.mocked(fetchScreenerValues).mockResolvedValue({ results: [] });

    const result = await runScreenerValues(["2330", "2317", "9999"], [{ field: "roe.roeTtmPct" }]);

    expect(result.count).toBe(3);
    expect(result.count).toBe(result.results.length);
  });

  it("resolves columns against the local filter catalog for metricName/fieldName/unit", async () => {
    vi.mocked(fetchScreenerValues).mockResolvedValue({ results: [] });

    const result = await runScreenerValues(["2330"], [{ field: "roe.roeTtmPct" }]);

    expect(result.columns).toEqual([
      { field: "roe.roeTtmPct", metricName: "ROE", fieldName: "ROE (TTM)", unit: "percent" },
    ]);
  });

  it("rejects a column field that doesn't exist in the filter catalog, without calling analysis-ts", async () => {
    await expect(runScreenerValues(["2330"], [{ field: "nope.nope" }])).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchScreenerValues).not.toHaveBeenCalled();
  });

  it('merges in "stock.price" from twse/tpex, not passed through to analysis-ts', async () => {
    vi.mocked(fetchScreenerValues).mockResolvedValue({ results: [{ symbol: "2330", name: "台積電", values: {} }] });
    vi.mocked(getLatestClosePrices).mockResolvedValue(
      new Map([["2330", { close: "2350.0000", tradeDate: "2026-08-28" }]]),
    );

    const result = await runScreenerValues(["2330"], [{ field: "stock.price" }]);

    expect(fetchScreenerValues).toHaveBeenCalledWith(["2330"], []);
    expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價", unit: "currency" });
    expect(result.results).toEqual([
      { symbol: "2330", name: "台積電", values: { "stock.price": { value: "2350.0000", knowledgeDate: "2026-08-28", nullReason: null } } },
    ]);
  });

  // analysis-ts attaches companyName directly on each row as of 2026-09-01 — passed through untouched,
  // no local merge step.
  it("passes each row's company name through directly from analysis-ts", async () => {
    vi.mocked(fetchScreenerValues).mockResolvedValue({
      results: [{ symbol: "2330", name: "台積電", values: {} }],
    });

    const result = await runScreenerValues(["2330"], [{ field: "roe.roeTtmPct" }]);

    expect(result.results[0]?.name).toBe("台積電");
  });
});

describe("runCompanyRank", () => {
  it("delegates to fetchCompanyRank with symbol/field/direction and passes the result through unchanged", async () => {
    const upstreamResult = {
      symbol: "2330",
      field: "dividendYield.EOD",
      found: true,
      value: 0.92,
      rank: 1152,
      totalCount: 1583,
      topPercent: 72.8,
    };
    vi.mocked(fetchCompanyRank).mockResolvedValue(upstreamResult);

    const result = await runCompanyRank("2330", "dividendYield.EOD", "desc");

    expect(fetchCompanyRank).toHaveBeenCalledWith("2330", "dividendYield.EOD", "desc");
    expect(result).toEqual(upstreamResult);
  });

  it("passes a found:false result through unchanged, without local catalog validation", async () => {
    const upstreamResult = {
      symbol: "NOPE9999",
      field: "dividendYield.EOD",
      found: false,
      value: null,
      rank: null,
      totalCount: null,
      topPercent: null,
    };
    vi.mocked(fetchCompanyRank).mockResolvedValue(upstreamResult);

    const result = await runCompanyRank("NOPE9999", "dividendYield.EOD", "asc");

    expect(fetchCompanyRank).toHaveBeenCalledWith("NOPE9999", "dividendYield.EOD", "asc");
    expect(result).toEqual(upstreamResult);
  });
});
