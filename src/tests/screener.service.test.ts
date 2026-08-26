import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../adapters/neon/index.js", () => ({
  queryNeon: vi.fn(),
}));

vi.mock("../domains/filterCatalog/index.js", () => ({
  findFilterField: vi.fn(),
}));

import { queryNeon } from "../adapters/neon/index.js";
import { findFilterField } from "../domains/filterCatalog/index.js";
import { runScreener } from "../domains/screener/screener.service.js";

type Lookup = Awaited<ReturnType<typeof findFilterField>>;

const KNOWN_FIELDS: Record<string, Lookup> = {
  "margins.grossMarginTtm": {
    categoryKey: "profitability",
    metricKey: "margins",
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
};

beforeEach(() => {
  vi.mocked(queryNeon).mockReset();
  vi.mocked(findFilterField).mockReset();
  vi.mocked(findFilterField).mockImplementation(async (metricKey, fieldKey) => {
    return KNOWN_FIELDS[`${metricKey}.${fieldKey}`] ?? null;
  });
});

describe("runScreener", () => {
  it("rejects an empty filters array", async () => {
    await expect(runScreener([], [])).rejects.toMatchObject({ statusCode: 400 });
    expect(queryNeon).not.toHaveBeenCalled();
  });

  it("rejects a filter field that doesn't exist in the filter catalog", async () => {
    await expect(
      runScreener([{ field: "nope.nope", min: 1, max: null, exclude: false }], []),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(queryNeon).not.toHaveBeenCalled();
  });

  it("rejects a catalog field whose metric isn't wired up to the analysis DB yet", async () => {
    await expect(
      runScreener([{ field: "unwired.someField", min: 1, max: null, exclude: false }], []),
    ).rejects.toMatchObject({ statusCode: 501 });
  });

  it("queries the analysis pool with an INNER JOIN per filtered metric and a normal-mode range condition", async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [{ symbol: "2330" }] } as never);

    await runScreener(
      [
        { field: "margins.grossMarginTtm", min: 20, max: null, exclude: false },
        { field: "roe.roeTtmPct", min: null, max: 30, exclude: false },
      ],
      [],
    );

    expect(queryNeon).toHaveBeenCalledOnce();
    const [db, sql, params] = vi.mocked(queryNeon).mock.calls[0]!;
    expect(db).toBe("analysis");
    expect(sql).toContain("FROM profitability_margins");
    expect(sql).toContain("FROM profitability_roe");
    expect(sql).toContain("INNER JOIN m_roe ON m_roe.symbol = m_margins.symbol");
    expect(sql).toContain("gross_margin_ttm");
    expect(sql).toContain("roe_ttm_pct");
    // Normal mode: value must be within [min, max].
    expect(sql).toMatch(/IS NOT NULL AND \(\$1::numeric IS NULL OR .*>= \$1::numeric\)/);
    expect(params).toEqual([20, null, null, 30]);
  });

  it("builds an outside-range condition when exclude is true", async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [] } as never);

    await runScreener([{ field: "margins.grossMarginTtm", min: 20, max: null, exclude: true }], []);

    const sql = vi.mocked(queryNeon).mock.calls[0]![1] as string;
    expect(sql).toMatch(/IS NOT NULL AND \(\(\$1::numeric IS NOT NULL AND .*< \$1::numeric\)/);
  });

  it("LEFT JOINs a metric that's only requested as a display column, not filtered", async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [{ symbol: "2330", "roe.roeTtmPct": "10.98" }] } as never);

    const result = await runScreener(
      [{ field: "margins.grossMarginTtm", min: 20, max: null, exclude: false }],
      [{ field: "roe.roeTtmPct" }],
    );

    const sql = vi.mocked(queryNeon).mock.calls[0]![1] as string;
    expect(sql).toContain("LEFT JOIN m_roe ON m_roe.symbol = m_margins.symbol");
    expect(result.columns).toEqual([{ field: "roe.roeTtmPct", metricName: "ROE", fieldName: "ROE (TTM)" }]);
    expect(result.results).toEqual([{ symbol: "2330", values: { "roe.roeTtmPct": "10.98" } }]);
  });
});
