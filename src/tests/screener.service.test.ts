import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../adapters/neon/index.js", () => ({
  queryNeon: vi.fn(),
}));

vi.mock("../domains/filterCatalog/index.js", () => ({
  findFilterFields: vi.fn(),
}));

vi.mock("../domains/stock/index.js", () => ({
  getLatestClosePrices: vi.fn(),
  getValuationRanking: vi.fn(),
}));

import { queryNeon } from "../adapters/neon/index.js";
import { findFilterFields } from "../domains/filterCatalog/index.js";
import { getLatestClosePrices, getValuationRanking } from "../domains/stock/index.js";
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
  // A metric the filterCatalog knows about but that isn't (yet) wired into ANALYSIS_METRIC_TABLES.
  "unwired.someField": {
    categoryKey: "guru",
    metricKey: "unwired",
    metricName: "Unwired",
    fieldKey: "someField",
    fieldName: "Some Field",
    period: "snapshot",
  },
  // Regression fixture: "beta1Y" is where the naive "insert _ before every uppercase letter" column-name
  // rule broke (produced "beta1_y" instead of the real column "beta_1y") — a digit immediately followed
  // by an uppercase unit letter ("1Y" = 1-year) is one glued suffix, not two separate segments.
  "beta.beta1Y": {
    categoryKey: "risk",
    metricKey: "beta",
    metricName: "Beta",
    fieldKey: "beta1Y",
    fieldName: "Beta (1Y)",
    period: "snapshot",
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
  vi.mocked(queryNeon).mockReset();
  vi.mocked(findFilterFields).mockReset();
  vi.mocked(findFilterFields).mockImplementation(async (refs) =>
    refs
      .map((ref) => KNOWN_FIELDS[`${ref.metricKey}.${ref.fieldKey}`] ?? null)
      .filter((f): f is Lookup => f !== null),
  );
  vi.mocked(getLatestClosePrices).mockReset();
  vi.mocked(getValuationRanking).mockReset();
});

describe("runScreener", () => {
  it("rejects an empty filters array", async () => {
    await expect(runScreener([], [], DEFAULT_PAGINATION)).rejects.toMatchObject({ statusCode: 400 });
    expect(queryNeon).not.toHaveBeenCalled();
  });

  it("rejects a filter field that doesn't exist in the filter catalog", async () => {
    await expect(
      runScreener([{ field: "nope.nope", min: 1, max: null, exclude: false }], [], DEFAULT_PAGINATION),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(queryNeon).not.toHaveBeenCalled();
  });

  it("rejects a catalog field whose metric isn't wired up to the analysis DB yet", async () => {
    await expect(
      runScreener([{ field: "unwired.someField", min: 1, max: null, exclude: false }], [], DEFAULT_PAGINATION),
    ).rejects.toMatchObject({ statusCode: 501 });
  });

  // Regression test: a row with a null report_date/trade_date (e.g. a failed/incomplete compute
  // upstream in oingg-analysis-ts — observed for real on symbols "1101"/"9999" in profitability_roe)
  // must never win "latest per symbol" over a properly dated row. Postgres sorts NULLs as the
  // largest value by default, so a bare `ORDER BY report_date DESC` would put the broken row first.
  it("excludes rows with a null latestOrderColumn from the CTE, so a broken row never wins DISTINCT ON as \"latest\"", async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [] } as never);

    await runScreener([{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }], [], DEFAULT_PAGINATION);

    const sql = vi.mocked(queryNeon).mock.calls[0]![1] as string;
    expect(sql).toContain('WHERE "report_date" IS NOT NULL AND data_type');
  });

  it("queries the analysis pool with an INNER JOIN per filtered metric and a normal-mode range condition", async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [{ symbol: "2330" }] } as never);

    await runScreener(
      [
        { field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false },
        { field: "roe.roeTtmPct", min: null, max: 30, exclude: false },
      ],
      [],
      DEFAULT_PAGINATION,
    );

    expect(queryNeon).toHaveBeenCalledOnce();
    const [db, sql, params] = vi.mocked(queryNeon).mock.calls[0]!;
    expect(db).toBe("analysis");
    expect(sql).toContain("FROM profitability_margins");
    expect(sql).toContain("FROM profitability_roe");
    expect(sql).toContain("INNER JOIN m_roe ON m_roe.symbol = m_grossMargin.symbol");
    expect(sql).toContain("gross_margin_ttm");
    expect(sql).toContain("roe_ttm_pct");
    // Normal mode: value must be within [min, max].
    expect(sql).toMatch(/IS NOT NULL AND \(\$1::numeric IS NULL OR .*>= \$1::numeric\)/);
    // Trailing pair is LIMIT/OFFSET (pageSize 50, offset 0 for page 1).
    expect(params).toEqual([20, null, null, 30, 50, 0]);
  });

  // Regression test: a digit immediately followed by an uppercase "unit" letter (e.g. "1Y" in "beta1Y",
  // meaning 1-year) must become "_1y", not "1_y" — the naive "insert _ before every uppercase" rule
  // produced the invalid column "beta1_y" instead of the real one, "beta_1y" (found via real DB
  // verification when wiring up the beta metric for the PresetTemplate seed data).
  it('maps a field key like "beta1Y" to the real column "beta_1y", not "beta1_y"', async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [] } as never);

    await runScreener([{ field: "beta.beta1Y", min: 0, max: null, exclude: false }], [], DEFAULT_PAGINATION);

    const sql = vi.mocked(queryNeon).mock.calls[0]![1] as string;
    expect(sql).toContain('"beta_1y"');
    expect(sql).not.toContain("beta1_y");
  });

  it("builds an outside-range condition when exclude is true", async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [] } as never);

    await runScreener([{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: true }], [], DEFAULT_PAGINATION);

    const sql = vi.mocked(queryNeon).mock.calls[0]![1] as string;
    expect(sql).toMatch(/IS NOT NULL AND \(\(\$1::numeric IS NOT NULL AND .*< \$1::numeric\)/);
  });

  it("LEFT JOINs a metric that's only requested as a display column, not filtered", async () => {
    vi.mocked(queryNeon).mockResolvedValue({
      rows: [{ symbol: "2330", "roe.roeTtmPct": "10.98", __totalCount: "1" }],
    } as never);

    const result = await runScreener(
      [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
      [{ field: "roe.roeTtmPct" }],
      DEFAULT_PAGINATION,
    );

    const sql = vi.mocked(queryNeon).mock.calls[0]![1] as string;
    expect(sql).toContain("LEFT JOIN m_roe ON m_roe.symbol = m_grossMargin.symbol");
    expect(result.columns).toEqual([{ field: "roe.roeTtmPct", metricName: "ROE", fieldName: "ROE (TTM)" }]);
    expect(result.results).toEqual([{ symbol: "2330", values: { "roe.roeTtmPct": "10.98" } }]);
  });

  it('merges in "stock.price" (a special, non-catalog column) from twse/tpex instead of the analysis DB', async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [{ symbol: "2330" }, { symbol: "2317" }] } as never);
    vi.mocked(getLatestClosePrices).mockResolvedValue(new Map([["2330", "2350.0000"]]));

    const result = await runScreener(
      [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
      [{ field: "stock.price" }],
      DEFAULT_PAGINATION,
    );

    // "stock.price" must never leak into the analysis-DB SQL — it isn't a filterCatalog field.
    const sql = vi.mocked(queryNeon).mock.calls[0]![1] as string;
    expect(sql).not.toContain("stock");
    // One batched call for the whole result set, not one call per symbol.
    expect(getLatestClosePrices).toHaveBeenCalledTimes(1);
    expect(getLatestClosePrices).toHaveBeenCalledWith(["2330", "2317"]);
    expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價" });
    expect(result.results).toEqual([
      { symbol: "2330", values: { "stock.price": "2350.0000" } },
      { symbol: "2317", values: { "stock.price": null } },
    ]);
  });

  // Regression test: filters and display columns used to each be resolved against the filter catalog
  // one at a time (one query per field). Must be a single batched lookup covering both.
  it("resolves all filter and column fields in a single batched catalog lookup", async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [] } as never);

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
    it("adds LIMIT/OFFSET params derived from page/pageSize and reports total/page/pageSize/totalPages from the window function", async () => {
      vi.mocked(queryNeon).mockResolvedValue({
        rows: [
          { symbol: "2330", __totalCount: "120" },
          { symbol: "2317", __totalCount: "120" },
        ],
      } as never);

      const result = await runScreener(
        [{ field: "grossMargin.grossMarginTtm", min: 20, max: null, exclude: false }],
        [],
        { page: 3, pageSize: 2 },
      );

      const [, sql, params] = vi.mocked(queryNeon).mock.calls[0]!;
      expect(sql).toContain('COUNT(*) OVER() AS "__totalCount"');
      expect(sql).toMatch(/LIMIT \$\d+::int OFFSET \$\d+::int/);
      // page 3, pageSize 2 -> offset 4. Filter params (min, max) come first, then [pageSize, offset].
      expect(params).toEqual([20, null, 2, 4]);

      expect(result.count).toBe(120);
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(2);
      expect(result.totalPages).toBe(60);
      // The internal window-function column must never leak into a row's values.
      expect(result.results).toEqual([
        { symbol: "2330", values: {} },
        { symbol: "2317", values: {} },
      ]);
    });

    it("reports count 0 and totalPages 0 when nothing matches, instead of NaN from an empty row set", async () => {
      vi.mocked(queryNeon).mockResolvedValue({ rows: [] } as never);

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
  it("orders by the ranked field's own value (not symbol), excludes nulls, and has no threshold params — just LIMIT", async () => {
    vi.mocked(queryNeon).mockResolvedValue({
      rows: [
        { symbol: "2330", "roe.roeTtmPct": "30.5" },
        { symbol: "2317", "roe.roeTtmPct": "25.1" },
      ],
    } as never);

    const result = await runRanking("roe.roeTtmPct", "desc", 10, []);

    const [db, sql, params] = vi.mocked(queryNeon).mock.calls[0]!;
    expect(db).toBe("analysis");
    expect(sql).toContain('WHERE m_roe."roe_ttm_pct" IS NOT NULL');
    // The CTE's own internal "ORDER BY symbol, ... DESC" (picking each symbol's latest row) is expected
    // and unrelated — what matters is the outer query's final ORDER BY sorts by the ranked value itself.
    expect(sql).toMatch(/\)\s*SELECT[\s\S]*ORDER BY m_roe\."roe_ttm_pct" DESC/);
    // No filter thresholds to parameterize — the only param is the LIMIT.
    expect(params).toEqual([10]);

    expect(result.field).toBe("roe.roeTtmPct");
    expect(result.direction).toBe("desc");
    expect(result.columns).toEqual([{ field: "roe.roeTtmPct", metricName: "ROE", fieldName: "ROE (TTM)" }]);
    expect(result.results).toEqual([
      { symbol: "2330", values: { "roe.roeTtmPct": "30.5" } },
      { symbol: "2317", values: { "roe.roeTtmPct": "25.1" } },
    ]);
  });

  it('sorts ASC for "lowest first" rankings (e.g. lowest P/E)', async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [] } as never);

    await runRanking("roe.roeTtmPct", "asc", 5, []);

    const sql = vi.mocked(queryNeon).mock.calls[0]![1] as string;
    expect(sql).toMatch(/ORDER BY m_roe\."roe_ttm_pct" ASC/);
  });

  it("rejects a field the filter catalog doesn't know about", async () => {
    await expect(runRanking("nope.nope", "desc", 10, [])).rejects.toMatchObject({ statusCode: 400 });
    expect(queryNeon).not.toHaveBeenCalled();
  });

  it("rejects a catalog field whose metric isn't wired up to the analysis DB yet", async () => {
    await expect(runRanking("unwired.someField", "desc", 10, [])).rejects.toMatchObject({ statusCode: 501 });
  });

  it("adds extra display columns via LEFT JOIN, same as runScreener, without disturbing the ranking", async () => {
    vi.mocked(queryNeon).mockResolvedValue({
      rows: [{ symbol: "2330", "roe.roeTtmPct": "30.5", "grossMargin.grossMarginTtm": "55.2" }],
    } as never);

    const result = await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "grossMargin.grossMarginTtm" }]);

    const sql = vi.mocked(queryNeon).mock.calls[0]![1] as string;
    expect(sql).toContain("LEFT JOIN m_grossMargin ON m_grossMargin.symbol = m_roe.symbol");
    expect(result.columns).toContainEqual({
      field: "grossMargin.grossMarginTtm",
      metricName: "Margins",
      fieldName: "Gross Margin (TTM)",
    });
    expect(result.results[0]?.values).toMatchObject({ "grossMargin.grossMarginTtm": "55.2" });
  });

  it('merges "stock.price" into results the same way runScreener does', async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [{ symbol: "2330", "roe.roeTtmPct": "30.5" }] } as never);
    vi.mocked(getLatestClosePrices).mockResolvedValue(new Map([["2330", "2410.0000"]]));

    const result = await runRanking("roe.roeTtmPct", "desc", 10, [{ field: "stock.price" }]);

    expect(getLatestClosePrices).toHaveBeenCalledWith(["2330"]);
    expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價" });
    expect(result.results[0]?.values).toMatchObject({ "stock.price": "2410.0000" });
  });

  it("caps the query at exactly LIMIT rows with no pagination metadata (not the paginated ScreenerResult shape)", async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [] } as never);

    const result = await runRanking("roe.roeTtmPct", "desc", 3, []);

    expect(vi.mocked(queryNeon).mock.calls[0]![1]).toMatch(/LIMIT \$1::int/);
    expect(vi.mocked(queryNeon).mock.calls[0]![2]).toEqual([3]);
    expect(result).not.toHaveProperty("count");
    expect(result).not.toHaveProperty("page");
  });

  // Regression coverage: per.peRatio/pbr.pbRatio/dividendYield.dividendYieldPct must bypass the
  // analysis-DB CTE path entirely (valuation_market_ratios is only lazily populated, currently a
  // couple of symbols) and go through getValuationRanking (twse+tpex daily_valuation, whole market)
  // instead — see VALUATION_RANKING_FIELDS and runValuationRanking.
  describe("valuation field override (per/pbr/dividendYield -> twse/tpex directly)", () => {
    it("routes per.peRatio to getValuationRanking instead of querying the analysis DB", async () => {
      vi.mocked(getValuationRanking).mockResolvedValue([
        { symbol: "1240", value: "10.61" },
        { symbol: "2330", value: "27.82" },
      ]);

      const result = await runRanking("per.peRatio", "asc", 10, []);

      expect(getValuationRanking).toHaveBeenCalledWith("peRatio", "asc", 10);
      expect(queryNeon).not.toHaveBeenCalled();
      expect(result).toEqual({
        field: "per.peRatio",
        direction: "asc",
        columns: [{ field: "per.peRatio", metricName: "本益比 PER", fieldName: "本益比 PER" }],
        results: [
          { symbol: "1240", values: { "per.peRatio": "10.61" } },
          { symbol: "2330", values: { "per.peRatio": "27.82" } },
        ],
      });
    });

    it("still merges stock.price in when requested alongside a valuation ranking", async () => {
      vi.mocked(getValuationRanking).mockResolvedValue([{ symbol: "2330", value: "27.82" }]);
      vi.mocked(getLatestClosePrices).mockResolvedValue(new Map([["2330", "2420.0000"]]));

      const result = await runRanking("per.peRatio", "asc", 10, [{ field: "stock.price" }]);

      expect(result.columns).toContainEqual({ field: "stock.price", metricName: "股票", fieldName: "股價" });
      expect(result.results[0]?.values).toMatchObject({ "stock.price": "2420.0000" });
    });

    it("rejects combining a valuation ranking with any analysis-DB column other than stock.price", async () => {
      await expect(
        runRanking("per.peRatio", "asc", 10, [{ field: "roe.roeTtmPct" }]),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(getValuationRanking).not.toHaveBeenCalled();
    });
  });
});
