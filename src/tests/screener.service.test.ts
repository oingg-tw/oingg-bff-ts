import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeCatalogLookup, fakeMetricCatalog } from "@/tests/fakes/metricCatalog.js";
import { fakeScreenerGateway, fakeStockGateway } from "@/tests/fakes/analysisGateways.js";
import { runRanking, runScreener, runScreenerValues } from "@/application/proxy/screener/screener.service.js";
import type { MetricFieldLookup } from "@/application/metricCatalog/metricCatalog.types.js";
import type { Pagination } from "@/application/proxy/screener/pagination.js";

const DEFAULT_PAGINATION: Pagination = { page: 1, pageSize: 50 };

type Lookup = MetricFieldLookup;

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

/**
 * Typed fakes of the three ports this service takes, rebuilt per test. The gateway fakes are what let
 * each assertion below say "this input never reached analysis-ts" without knowing which client module
 * (or which of its two files) would have been called.
 *
 * stockGateway used to be a vi.mock of the proxy/stock barrel, because that slice wasn't on ports yet.
 * It is a typed fake now, so the "stock.price" assertions below check the port's contract rather than
 * one module's export list.
 */
let screenerGateway = fakeScreenerGateway();
let metricCatalog = fakeMetricCatalog();
let stockGateway = fakeStockGateway();
let deps = { screenerGateway, metricCatalog, stockGateway };

beforeEach(() => {
  screenerGateway = fakeScreenerGateway();
  metricCatalog = fakeMetricCatalog({ findFields: vi.fn(fakeCatalogLookup(KNOWN_FIELDS)) });
  stockGateway = fakeStockGateway();
  deps = { screenerGateway, metricCatalog, stockGateway };
});

describe("runScreener", () => {
  it("rejects an empty filters array", async () => {
    await expect(runScreener([], [], DEFAULT_PAGINATION, undefined, undefined, undefined, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(screenerGateway.runScreener).not.toHaveBeenCalled();
  });

  it("rejects a filter field that doesn't exist in the filter catalog, without calling analysis-ts", async () => {
    await expect(
      runScreener([{ field: "nope.nope", min: 1, max: null, exclude: false }], [], DEFAULT_PAGINATION, undefined, undefined, undefined, deps),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(screenerGateway.runScreener).not.toHaveBeenCalled();
  });

  // Regression coverage for the direct-DB anti-pattern fix (2026-09-01): the general screener query now
  // runs on analysis-ts's own POST /screener (see analysisScreenerClient.ts), which covers the entire
  // /filters catalog by construction — there is no "metric isn't wired up yet" 501 case left on bff-ts's
  // side. A field that exists in the catalog always delegates through.
  it("delegates the filters/columns/pagination straight to the gateway's runScreener", async () => {
    vi.mocked(screenerGateway.runScreener).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

    await runScreener(
      [
        { field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false },
        { field: "roe.roeTtmPct", min: null, max: 30, exclude: false },
      ],
      [{ field: "roe.roeTtmPct" }],
      { page: 2, pageSize: 25 },
      undefined,
      undefined,
      undefined,
      deps,
    );

    expect(screenerGateway.runScreener).toHaveBeenCalledWith(
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
      vi.mocked(screenerGateway.runScreener).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

      await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [],
        DEFAULT_PAGINATION,
        { field: "symbol", order: "desc" },
        undefined,
        undefined,
        deps,
      );

      expect(screenerGateway.runScreener).toHaveBeenCalledWith(
        expect.anything(),
        [],
        DEFAULT_PAGINATION,
        { field: "symbol", order: "desc" },
        undefined,
        undefined,
      );
    });

    it("passes a sortField that is one of this request's own columns through to the gateway's runScreener", async () => {
      vi.mocked(screenerGateway.runScreener).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

      await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [{ field: "roe.roeTtmPct" }],
        DEFAULT_PAGINATION,
        { field: "roe.roeTtmPct", order: "asc" },
        undefined,
        undefined,
        deps,
      );

      expect(screenerGateway.runScreener).toHaveBeenCalledWith(
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
          undefined,
          undefined,
          deps,
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(screenerGateway.runScreener).not.toHaveBeenCalled();
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
          undefined,
          undefined,
          deps,
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(screenerGateway.runScreener).not.toHaveBeenCalled();
    });
  });

  it("resolves the requested columns against the local filter catalog for metricName/fieldName in the response", async () => {
    vi.mocked(screenerGateway.runScreener).mockResolvedValue({
      count: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      results: [{ symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "10.98", knowledgeDate: "26Q2", nullReason: null, formulaVersion: 1 } } }],
    });

    const result = await runScreener(
      [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
      [{ field: "roe.roeTtmPct" }],
      DEFAULT_PAGINATION,
      undefined,
      undefined,
      undefined,
      deps,
    );

    expect(result.columns).toEqual([{ field: "roe.roeTtmPct", metricName: "ROE", fieldName: "ROE (TTM)", unit: "percent" }]);
    expect(result.results).toEqual([
      { symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "10.98", knowledgeDate: "26Q2", nullReason: null, formulaVersion: 1 } } },
    ]);
  });

  it('merges in "stock.price" (a special, non-catalog column) from twse/tpex, not passed through to analysis-ts', async () => {
    vi.mocked(screenerGateway.runScreener).mockResolvedValue({
      count: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      results: [
        { symbol: "2330", name: "台積電", values: {} },
        { symbol: "2317", name: "鴻海", values: {} },
      ],
    });
    vi.mocked(stockGateway.getLatestClosePrices).mockResolvedValue(
      new Map([["2330", { close: "2350.0000", tradeDate: "2026-08-28", previousClose: null, previousTradeDate: null, latestClose: null, latestCloseDate: null }]]),
    );

    const result = await runScreener(
      [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
      [{ field: "stock.price" }],
      DEFAULT_PAGINATION,
      undefined,
      undefined,
      undefined,
      deps,
    );

    // "stock.price" must never leak into the columns sent to analysis-ts — it isn't a metricCatalog field.
    expect(screenerGateway.runScreener).toHaveBeenCalledWith(expect.anything(), [], DEFAULT_PAGINATION, undefined, undefined, undefined);
    // One batched call for the whole result set, not one call per symbol.
    expect(stockGateway.getLatestClosePrices).toHaveBeenCalledTimes(1);
    expect(stockGateway.getLatestClosePrices).toHaveBeenCalledWith(["2330", "2317"]);
    expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價", unit: "currency" });
    expect(result.results).toEqual([
      { symbol: "2330", name: "台積電", values: { "stock.price": { value: "2350.0000", knowledgeDate: "2026-08-28", nullReason: null, formulaVersion: null } } },
      { symbol: "2317", name: "鴻海", values: { "stock.price": { value: null, knowledgeDate: null, nullReason: null, formulaVersion: null } } },
    ]);
  });

  // analysis-ts attaches companyName directly on each row as of 2026-09-01 (see analysisScreenerClient.ts's
  // normalizeRows) — bff-ts no longer merges names in from a local cache, just passes the field through.
  it("passes each row's company name through directly from analysis-ts, without any local merge step", async () => {
    vi.mocked(screenerGateway.runScreener).mockResolvedValue({
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
      undefined,
      undefined,
      undefined,
      deps,
    );

    expect(result.results).toEqual([
      { symbol: "2330", name: "台積電", values: {} },
      { symbol: "2317", name: null, values: {} },
    ]);
  });

  // Regression test: filters and display columns used to each be resolved against the filter catalog
  // one at a time (one query per field). Must be a single batched lookup covering both.
  it("resolves all filter and column fields in a single batched catalog lookup", async () => {
    vi.mocked(screenerGateway.runScreener).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

    await runScreener(
      [
        { field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false },
        { field: "roe.roeTtmPct", min: null, max: 30, exclude: false },
      ],
      [{ field: "roe.roeTtmPct" }],
      DEFAULT_PAGINATION,
      undefined,
      undefined,
      undefined,
      deps,
    );

    expect(metricCatalog.findFields).toHaveBeenCalledTimes(1);
    expect(metricCatalog.findFields).toHaveBeenCalledWith([
      { field: "grossMargin.grossMarginTtm", metricKey: "grossMargin", fieldKey: "grossMarginTtm" },
      { field: "roe.roeTtmPct", metricKey: "roe", fieldKey: "roeTtmPct" },
      { field: "roe.roeTtmPct", metricKey: "roe", fieldKey: "roeTtmPct" },
    ]);
  });

  describe("pagination", () => {
    it("passes count/page/pageSize/totalPages straight through from analysis-ts", async () => {
      vi.mocked(screenerGateway.runScreener).mockResolvedValue({
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
        undefined,
        undefined,
        undefined,
        deps,
      );

      expect(result.count).toBe(120);
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(2);
      expect(result.totalPages).toBe(60);
    });

    it("reports count 0 and totalPages 0 when nothing matches", async () => {
      vi.mocked(screenerGateway.runScreener).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

      const result = await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [],
        { page: 1, pageSize: 50 },
        undefined,
        undefined,
        undefined,
        deps,
      );

      expect(result.count).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(result.results).toEqual([]);
    });
  });
});

describe("runRanking", () => {
  it("delegates field/direction/limit and extra columns to the gateway's runRanking", async () => {
    vi.mocked(screenerGateway.runRanking).mockResolvedValue({ results: [] });

    await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "grossMargin.grossMarginTtm" }], undefined, undefined, deps);

    expect(screenerGateway.runRanking).toHaveBeenCalledWith(
      "roe.roeTtmPct",
      "desc",
      10,
      [{ field: "grossMargin.grossMarginTtm" }],
      undefined,
      undefined,
    );
  });

  it("resolves the ranked field and extra columns against the local catalog for the response's columns", async () => {
    vi.mocked(screenerGateway.runRanking).mockResolvedValue({
      results: [
        { symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "30.5", knowledgeDate: "26Q2", nullReason: null, formulaVersion: 1 } } },
        { symbol: "2317", name: "鴻海", values: { "roe.roeTtmPct": { value: "25.1", knowledgeDate: "26Q1", nullReason: null, formulaVersion: 1 } } },
      ],
    });

    const result = await runRanking("roe.roeTtmPct", "desc", 10, [], undefined, undefined, deps);

    expect(result.field).toBe("roe.roeTtmPct");
    expect(result.direction).toBe("desc");
    expect(result.columns).toEqual([{ field: "roe.roeTtmPct", metricName: "ROE", fieldName: "ROE (TTM)", unit: "percent" }]);
    // Different symbols can legitimately have different knowledgeDate for the same field (one filed later).
    expect(result.results).toEqual([
      { symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "30.5", knowledgeDate: "26Q2", nullReason: null, formulaVersion: 1 } } },
      { symbol: "2317", name: "鴻海", values: { "roe.roeTtmPct": { value: "25.1", knowledgeDate: "26Q1", nullReason: null, formulaVersion: 1 } } },
    ]);
  });

  it("rejects a field the filter catalog doesn't know about, without calling analysis-ts", async () => {
    await expect(runRanking("nope.nope", "desc", 10, [], undefined, undefined, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(screenerGateway.runRanking).not.toHaveBeenCalled();
  });

  it("doesn't re-resolve or re-pass the ranked field as an extra column when it's also listed in columns", async () => {
    vi.mocked(screenerGateway.runRanking).mockResolvedValue({ results: [] });

    await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "roe.roeTtmPct" }, { field: "grossMargin.grossMarginTtm" }], undefined, undefined, deps);

    expect(screenerGateway.runRanking).toHaveBeenCalledWith(
      "roe.roeTtmPct",
      "desc",
      10,
      [{ field: "grossMargin.grossMarginTtm" }],
      undefined,
      undefined,
    );
  });

  it("adds extra display columns to the response's columns array", async () => {
    vi.mocked(screenerGateway.runRanking).mockResolvedValue({
      results: [
        {
          symbol: "2330",
          name: "台積電",
          values: {
            "roe.roeTtmPct": { value: "30.5", knowledgeDate: "26Q2", nullReason: null, formulaVersion: 1 },
            "grossMargin.grossMarginTtm": { value: "55.2", knowledgeDate: "26Q2", nullReason: null, formulaVersion: 1 },
          },
        },
      ],
    });

    const result = await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "grossMargin.grossMarginTtm" }], undefined, undefined, deps);

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
    vi.mocked(screenerGateway.runRanking).mockResolvedValue({
      results: [{ symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "30.5", knowledgeDate: "26Q2", nullReason: null, formulaVersion: 1 } } }],
    });
    vi.mocked(stockGateway.getLatestClosePrices).mockResolvedValue(
      new Map([["2330", { close: "2410.0000", tradeDate: "2026-08-28", previousClose: null, previousTradeDate: null, latestClose: null, latestCloseDate: null }]]),
    );

    const result = await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "stock.price" }], undefined, undefined, deps);

    // "stock.price" must never be sent to analysis-ts as an extra column — it isn't a metricCatalog field.
    expect(screenerGateway.runRanking).toHaveBeenCalledWith("roe.roeTtmPct", "desc", 10, [], undefined, undefined);
    expect(stockGateway.getLatestClosePrices).toHaveBeenCalledWith(["2330"]);
    expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價", unit: "currency" });
    expect(result.results[0]?.values).toMatchObject({
      "stock.price": { value: "2410.0000", knowledgeDate: "2026-08-28" },
    });
  });

  it("returns exactly what the gateway's runRanking gives back, no pagination metadata on the result", async () => {
    vi.mocked(screenerGateway.runRanking).mockResolvedValue({ results: [] });

    const result = await runRanking("roe.roeTtmPct", "desc", 3, [], undefined, undefined, deps);

    expect(result).not.toHaveProperty("count");
    expect(result).not.toHaveProperty("page");
  });

  // Regression coverage: per.peRatio/pbr.pbRatio/dividendYield.dividendYieldPct must bypass the general
  // screener path entirely and delegate to oingg-analysis-ts's own GET /valuation/ranking (the gateway's
  // getValuationRanking) instead — ranking is a second-order computation over raw market data (merge
  // twse+tpex, exclude non-positive P/E or P/B, sort) that belongs to analysis-ts's dedicated endpoint,
  // not the general screener query. See VALUATION_RANKING_FIELDS and runValuationRanking.
  describe("valuation field override (per/pbr/dividendYield -> oingg-analysis-ts's ranking endpoint)", () => {
    // Trigger keys updated 2026-09-08 for analysis-ts's pitMetrics rebuild — see VALUATION_RANKING_FIELDS.
    it("routes exchangePeRatio.EOD to the gateway's getValuationRanking instead of the general screener ranking path", async () => {
      vi.mocked(screenerGateway.getValuationRanking).mockResolvedValue({
        tradeDate: "2026-08-28",
        rankings: [
          { symbol: "1240", name: "撼訊", value: 10.61 },
          { symbol: "2330", name: "台積電", value: 27.82 },
        ],
      });

      const result = await runRanking("exchangePeRatio.EOD", "asc", 10, [], undefined, undefined, deps);

      expect(screenerGateway.getValuationRanking).toHaveBeenCalledWith("peRatio", "asc", 10);
      expect(screenerGateway.runRanking).not.toHaveBeenCalled();
      expect(result).toEqual({
        field: "exchangePeRatio.EOD",
        direction: "asc",
        columns: [{ field: "exchangePeRatio.EOD", metricName: "exchangePeRatio", fieldName: "EOD", unit: null }],
        results: [
          { symbol: "1240", name: "撼訊", values: { "exchangePeRatio.EOD": { value: "10.61", knowledgeDate: "2026-08-28", nullReason: null, formulaVersion: null } } },
          { symbol: "2330", name: "台積電", values: { "exchangePeRatio.EOD": { value: "27.82", knowledgeDate: "2026-08-28", nullReason: null, formulaVersion: null } } },
        ],
      });
    });

    it("still merges stock.price in when requested alongside a valuation ranking", async () => {
      vi.mocked(screenerGateway.getValuationRanking).mockResolvedValue({
        tradeDate: "2026-08-28",
        rankings: [{ symbol: "2330", name: "台積電", value: 27.82 }],
      });
      vi.mocked(stockGateway.getLatestClosePrices).mockResolvedValue(
        new Map([["2330", { close: "2420.0000", tradeDate: "2026-08-28", previousClose: null, previousTradeDate: null, latestClose: null, latestCloseDate: null }]]),
      );

      const result = await runRanking("exchangePeRatio.EOD", "asc", 10, [{ field: "stock.price" }], undefined, undefined, deps);

      expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價", unit: "currency" });
      expect(result.results[0]?.values).toMatchObject({
        "stock.price": { value: "2420.0000", knowledgeDate: "2026-08-28" },
      });
    });

    it("rejects combining a valuation ranking with any column other than stock.price", async () => {
      await expect(runRanking("exchangePeRatio.EOD", "asc", 10, [{ field: "roe.roeTtmPct" }], undefined, undefined, deps)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(screenerGateway.getValuationRanking).not.toHaveBeenCalled();
    });

    // The valuation ranking path is a separate analysis-ts endpoint with no filter concept at all — it
    // can't be given sectorCodes, unlike the general ranking path below.
    it("rejects sectorCodes on a valuation ranking (no sector-filter concept on that upstream endpoint)", async () => {
      await expect(runRanking("exchangePeRatio.EOD", "asc", 10, [], ["24"], undefined, deps)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(screenerGateway.getValuationRanking).not.toHaveBeenCalled();
    });

    it("rejects excludeSectorCodes on a valuation ranking, same as sectorCodes", async () => {
      await expect(runRanking("exchangePeRatio.EOD", "asc", 10, [], undefined, ["24"], deps)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(screenerGateway.getValuationRanking).not.toHaveBeenCalled();
    });
  });

  describe("sectorCodes", () => {
    it("forwards sectorCodes to the gateway's runScreener on the general screener path", async () => {
      vi.mocked(screenerGateway.runScreener).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

      await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [],
        DEFAULT_PAGINATION,
        undefined,
        ["24", "01"],
        undefined,
        deps,
      );

      expect(screenerGateway.runScreener).toHaveBeenCalledWith(expect.anything(), [], DEFAULT_PAGINATION, undefined, ["24", "01"], undefined);
    });

    it("forwards sectorCodes to the gateway's runRanking on the general ranking path", async () => {
      vi.mocked(screenerGateway.runRanking).mockResolvedValue({ results: [] });

      await runRanking("roe.roeTtmPct", "desc", 10, [], ["24"], undefined, deps);

      expect(screenerGateway.runRanking).toHaveBeenCalledWith("roe.roeTtmPct", "desc", 10, [], ["24"], undefined);
    });
  });

  describe("excludeSectorCodes", () => {
    it("forwards excludeSectorCodes to the gateway's runScreener on the general screener path", async () => {
      vi.mocked(screenerGateway.runScreener).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

      await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [],
        DEFAULT_PAGINATION,
        undefined,
        undefined,
        ["24", "01"],
        deps,
      );

      expect(screenerGateway.runScreener).toHaveBeenCalledWith(expect.anything(), [], DEFAULT_PAGINATION, undefined, undefined, ["24", "01"]);
    });

    it("forwards excludeSectorCodes to the gateway's runRanking on the general ranking path", async () => {
      vi.mocked(screenerGateway.runRanking).mockResolvedValue({ results: [] });

      await runRanking("roe.roeTtmPct", "desc", 10, [], undefined, ["24"], deps);

      expect(screenerGateway.runRanking).toHaveBeenCalledWith("roe.roeTtmPct", "desc", 10, [], undefined, ["24"]);
    });
  });
});

describe("runScreenerValues", () => {
  it("rejects an empty symbols array", async () => {
    await expect(runScreenerValues([], [{ field: "roe.roeTtmPct" }], deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(screenerGateway.getValues).not.toHaveBeenCalled();
  });

  it("rejects an empty columns array", async () => {
    await expect(runScreenerValues(["2330"], [], deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(screenerGateway.getValues).not.toHaveBeenCalled();
  });

  it("rejects more than 200 symbols in one request", async () => {
    const symbols = Array.from({ length: 201 }, (_, i) => String(i));
    await expect(runScreenerValues(symbols, [{ field: "roe.roeTtmPct" }], deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(screenerGateway.getValues).not.toHaveBeenCalled();
  });

  it("delegates symbols and resolved columns straight to the gateway's getValues", async () => {
    vi.mocked(screenerGateway.getValues).mockResolvedValue({ results: [] });

    await runScreenerValues(["2330", "2317"], [{ field: "roe.roeTtmPct" }], deps);

    expect(screenerGateway.getValues).toHaveBeenCalledWith(["2330", "2317"], [{ field: "roe.roeTtmPct" }]);
  });

  // The core point of this endpoint: every requested symbol gets a row, even if analysis-ts has no data
  // for it — never silently drop a symbol the caller already has on screen.
  it("returns a row for every requested symbol, with empty values for one analysis-ts didn't return", async () => {
    vi.mocked(screenerGateway.getValues).mockResolvedValue({
      results: [{ symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "34.78", knowledgeDate: "26Q2", nullReason: null, formulaVersion: 1 } } }],
    });

    const result = await runScreenerValues(["2330", "9999"], [{ field: "roe.roeTtmPct" }], deps);

    expect(result.results).toEqual([
      { symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "34.78", knowledgeDate: "26Q2", nullReason: null, formulaVersion: 1 } } },
      { symbol: "9999", name: null, values: {} },
    ]);
  });

  it("count always equals results.length (== the number of symbols requested)", async () => {
    vi.mocked(screenerGateway.getValues).mockResolvedValue({ results: [] });

    const result = await runScreenerValues(["2330", "2317", "9999"], [{ field: "roe.roeTtmPct" }], deps);

    expect(result.count).toBe(3);
    expect(result.count).toBe(result.results.length);
  });

  it("resolves columns against the local filter catalog for metricName/fieldName/unit", async () => {
    vi.mocked(screenerGateway.getValues).mockResolvedValue({ results: [] });

    const result = await runScreenerValues(["2330"], [{ field: "roe.roeTtmPct" }], deps);

    expect(result.columns).toEqual([
      { field: "roe.roeTtmPct", metricName: "ROE", fieldName: "ROE (TTM)", unit: "percent" },
    ]);
  });

  it("rejects a column field that doesn't exist in the filter catalog, without calling analysis-ts", async () => {
    await expect(runScreenerValues(["2330"], [{ field: "nope.nope" }], deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(screenerGateway.getValues).not.toHaveBeenCalled();
  });

  it('merges in "stock.price" from twse/tpex, not passed through to analysis-ts', async () => {
    vi.mocked(screenerGateway.getValues).mockResolvedValue({ results: [{ symbol: "2330", name: "台積電", values: {} }] });
    vi.mocked(stockGateway.getLatestClosePrices).mockResolvedValue(
      new Map([["2330", { close: "2350.0000", tradeDate: "2026-08-28", previousClose: null, previousTradeDate: null, latestClose: null, latestCloseDate: null }]]),
    );

    const result = await runScreenerValues(["2330"], [{ field: "stock.price" }], deps);

    // 只要報價欄位時不打 analysis-ts——它對空的 columns 回 400（2026-10-06 實測），所以 name 是 null。
    expect(screenerGateway.getValues).not.toHaveBeenCalled();
    expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價", unit: "currency" });
    expect(result.results).toEqual([
      { symbol: "2330", name: null, values: { "stock.price": { value: "2350.0000", knowledgeDate: "2026-08-28", nullReason: null, formulaVersion: null } } },
    ]);
  });

  // 2026-10-06：前一日收盤價原樣來自同一次批次報價，knowledgeDate 是它真正的日期（可能跳過沒成交的日子）。
  // 只要了 stock.previousClose 就只回它；沒有報價的代號兩個值都是 null。
  // stock.price 維持「最新交易日的收盤，沒成交就是 null」；stock.latestClose 是最近一次有成交的收盤，
  // knowledgeDate 是那次成交的日期。兩欄並存，bff-ts 不拿其中一個去補另一個。
  it('merges "stock.latestClose" with its own date while "stock.price" stays null on a no-trade day', async () => {
    vi.mocked(screenerGateway.getValues).mockResolvedValue({ results: [] });
    vi.mocked(stockGateway.getLatestClosePrices).mockResolvedValue(
      new Map([["8416", { close: null, tradeDate: "2026-10-06", previousClose: "169.5", previousTradeDate: "2026-10-05", latestClose: "169.5", latestCloseDate: "2026-10-05" }]]),
    );

    const result = await runScreenerValues(["8416"], [{ field: "stock.price" }, { field: "stock.latestClose" }], deps);

    expect(result.results[0]?.values).toEqual({
      "stock.price": { value: null, knowledgeDate: "2026-10-06", nullReason: null, formulaVersion: null },
      "stock.latestClose": { value: "169.5", knowledgeDate: "2026-10-05", nullReason: null, formulaVersion: null },
    });
  });

  it('merges "stock.previousClose" from the same price lookup, with its own date', async () => {
    vi.mocked(screenerGateway.getValues).mockResolvedValue({ results: [{ symbol: "2330", name: "台積電", values: {} }] });
    vi.mocked(stockGateway.getLatestClosePrices).mockResolvedValue(
      new Map([["2330", { close: "2575", tradeDate: "2026-10-05", previousClose: "2500", previousTradeDate: "2026-10-02", latestClose: "2575", latestCloseDate: "2026-10-05" }]]),
    );

    const result = await runScreenerValues(["2330", "9999"], [{ field: "stock.previousClose" }], deps);

    expect(stockGateway.getLatestClosePrices).toHaveBeenCalledTimes(1);
    expect(result.columns).toEqual([{ field: "stock.previousClose", metricName: "股票", fieldName: "前一日收盤價", unit: "currency" }]);
    expect(result.results.map((row) => row.values)).toEqual([
      { "stock.previousClose": { value: "2500", knowledgeDate: "2026-10-02", nullReason: null, formulaVersion: null } },
      { "stock.previousClose": { value: null, knowledgeDate: null, nullReason: null, formulaVersion: null } },
    ]);
  });

  // analysis-ts attaches companyName directly on each row as of 2026-09-01 — passed through untouched,
  // no local merge step.
  it("passes each row's company name through directly from analysis-ts", async () => {
    vi.mocked(screenerGateway.getValues).mockResolvedValue({
      results: [{ symbol: "2330", name: "台積電", values: {} }],
    });

    const result = await runScreenerValues(["2330"], [{ field: "roe.roeTtmPct" }], deps);

    expect(result.results[0]?.name).toBe("台積電");
  });
});
