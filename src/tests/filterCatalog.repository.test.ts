import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {
  $executeRaw: vi.fn(async () => 0),
  filterCategory: { deleteMany: vi.fn() },
  filterMetric: { deleteMany: vi.fn() },
  filterMetricField: { deleteMany: vi.fn() },
};

const mockPrisma = {
  $transaction: vi.fn(async (callback: (tx: typeof mockTx) => Promise<void>) => callback(mockTx)),
  filterCategory: { findMany: vi.fn() },
};

vi.mock("@/adapters/neon/index.js", () => ({
  getPrismaClient: () => mockPrisma,
}));

import { listFilterCatalog, replaceFilterCatalog } from "@/domains/filterCatalog/filterCatalog.repository.js";
import type { FilterCategory } from "@/domains/filterCatalog/filterCatalog.types.js";

const SAMPLE_CATALOG: FilterCategory[] = [
  {
    key: "profitability",
    name: "Profitability",
    sort: 0,
    metrics: [
      {
        key: "eps",
        name: "EPS",
        path: "/profitability/eps",
        sort: 0,
        fields: [
          { key: "epsQuarterly", name: "EPS (quarterly)", period: "quarterly", sort: 0 },
          { key: "epsTtm", name: "EPS (TTM)", period: "ttm", sort: 1 },
        ],
      },
    ],
  },
  {
    key: "guru",
    name: "Guru",
    sort: 1,
    metrics: [
      {
        key: "grahamNumber",
        name: "Graham Number",
        path: "/guru/graham-number",
        sort: 0,
        fields: [{ key: "grahamNumber", name: "Graham Number", period: "ttm", sort: 0 }],
      },
    ],
  },
];

describe("listFilterCatalog", () => {
  beforeEach(() => {
    vi.mocked(mockPrisma.filterCategory.findMany).mockReset();
  });

  // The response array is already in display order (queried with orderBy: position asc at every
  // level), but a frontend that reorders/filters the array client-side loses that implicit order — this
  // exposes the same "position" column explicitly as "sort" so it survives that kind of transformation.
  it("exposes each level's internal position as an explicit sort number", async () => {
    vi.mocked(mockPrisma.filterCategory.findMany).mockResolvedValue([
      {
        key: "technicals",
        name: "Technicals",
        position: 3,
        metrics: [
          {
            key: "bias",
            name: "BIAS",
            path: "/technicals/bias",
            description: null,
            source: null,
            position: 2,
            fields: [
              { key: "bias5d", name: "5 日乖離率", period: "daily", description: null, source: null, position: 0 },
              { key: "bias20d", name: "20 日乖離率", period: "daily", description: null, source: null, position: 1 },
            ],
          },
        ],
      },
    ] as never);

    const result = await listFilterCatalog();

    expect(result[0]?.sort).toBe(3);
    expect(result[0]?.metrics[0]?.sort).toBe(2);
    expect(result[0]?.metrics[0]?.fields[0]?.sort).toBe(0);
    expect(result[0]?.metrics[0]?.fields[1]?.sort).toBe(1);
  });

  // Coverage for the description/source tooltip fields (added to support frontend info-icon tooltips
  // per the "資料定義/來源透明" product ask). oingg-analysis-ts's actual convention (confirmed with
  // them directly) is to fill these in at the metric level only — the quarterly/TTM/etc. period
  // variants of one metric share the same definition and source, so it's not repeated per field.
  // A field without its own description/source must fall back to its metric's, so the frontend can
  // always just read field.description/field.source without knowing this upstream convention.
  it("falls back to the metric's description/source for a field that has none of its own", async () => {
    vi.mocked(mockPrisma.filterCategory.findMany).mockResolvedValue([
      {
        key: "profitability",
        name: "Profitability",
        position: 0,
        metrics: [
          {
            key: "roe",
            name: "ROE",
            path: "/profitability/roe",
            description: "股東權益報酬率，衡量股東投入資本的獲利效率。",
            source: "MOPS 季報財務比率",
            position: 0,
            fields: [
              { key: "roeTtmPct", name: "ROE", period: "ttm", description: null, source: null, position: 0 },
            ],
          },
        ],
      },
    ] as never);

    const result = await listFilterCatalog();

    expect(result[0]?.metrics[0]).toMatchObject({
      key: "roe",
      description: "股東權益報酬率，衡量股東投入資本的獲利效率。",
      source: "MOPS 季報財務比率",
    });
    expect(result[0]?.metrics[0]?.fields[0]).toMatchObject({
      key: "roeTtmPct",
      description: "股東權益報酬率，衡量股東投入資本的獲利效率。",
      source: "MOPS 季報財務比率",
    });
  });

  // Coverage for the unit field (percent/currency/times/ratio) — same metric-level-default,
  // field-can-override convention as description/source, but unlike those two, a field overriding its
  // metric's unit is a real, observed case (not just theoretical): dupont's own unit is "percent" but
  // dupont.assetTurnoverQuarterly is "times" — verified live against analysis-ts's real /filters response.
  it("falls back to the metric's unit for a field that has none of its own", async () => {
    vi.mocked(mockPrisma.filterCategory.findMany).mockResolvedValue([
      {
        key: "profitability",
        name: "Profitability",
        position: 0,
        metrics: [
          {
            key: "dupont",
            name: "杜邦分析",
            path: "/profitability/dupont",
            description: null,
            source: null,
            unit: "percent",
            position: 0,
            fields: [
              {
                key: "decomposedRoeQuarterlyPct",
                name: "組裝 ROE（杜邦）",
                period: "quarterly",
                description: null,
                source: null,
                unit: null,
                position: 0,
              },
              {
                key: "assetTurnoverQuarterly",
                name: "總資產周轉率",
                period: "quarterly",
                description: null,
                source: null,
                unit: "times",
                position: 1,
              },
            ],
          },
        ],
      },
    ] as never);

    const result = await listFilterCatalog();

    expect(result[0]?.metrics[0]?.unit).toBe("percent");
    // No unit of its own -> falls back to the metric's "percent".
    expect(result[0]?.metrics[0]?.fields[0]).toMatchObject({ key: "decomposedRoeQuarterlyPct", unit: "percent" });
    // Has its own unit -> keeps "times", doesn't inherit the metric's "percent".
    expect(result[0]?.metrics[0]?.fields[1]).toMatchObject({ key: "assetTurnoverQuarterly", unit: "times" });
  });

  it("keeps a field's own description/source when it has one, rather than always preferring the metric's", async () => {
    vi.mocked(mockPrisma.filterCategory.findMany).mockResolvedValue([
      {
        key: "profitability",
        name: "Profitability",
        position: 0,
        metrics: [
          {
            key: "roe",
            name: "ROE",
            path: "/profitability/roe",
            description: "metric-level definition",
            source: "metric-level source",
            position: 0,
            fields: [
              {
                key: "roeTtmPct",
                name: "ROE",
                period: "ttm",
                description: "field-level definition",
                source: "field-level source",
                position: 0,
              },
            ],
          },
        ],
      },
    ] as never);

    const result = await listFilterCatalog();

    expect(result[0]?.metrics[0]?.fields[0]).toMatchObject({
      description: "field-level definition",
      source: "field-level source",
    });
  });

  it("stays null when neither the field nor its metric has a description/source yet", async () => {
    vi.mocked(mockPrisma.filterCategory.findMany).mockResolvedValue([
      {
        key: "profitability",
        name: "Profitability",
        position: 0,
        metrics: [
          {
            key: "roe",
            name: "ROE",
            path: "/profitability/roe",
            description: null,
            source: null,
            position: 0,
            fields: [
              { key: "roeTtmPct", name: "ROE", period: "ttm", description: null, source: null, position: 0 },
            ],
          },
        ],
      },
    ] as never);

    const result = await listFilterCatalog();

    expect(result[0]?.metrics[0]?.fields[0]).toMatchObject({ description: null, source: null });
  });
});

describe("replaceFilterCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression test: this used to `deleteMany()` the whole table then `createMany()` fresh rows on
  // every sync (called once at every server startup). FilterMetricField cascades onDelete into
  // ScreenerPresetFilter, so recreating a field that already existed — same key, same data — silently
  // wiped every user's saved preset filters on every restart, even though nothing about that field
  // actually changed. Upserting by natural key must leave an unchanged/kept row's identity intact
  // (no delete at all for it), and only ever delete a row that's genuinely absent from the new catalog.
  it("upserts via a single batched statement per table instead of wiping and recreating every row", async () => {
    await replaceFilterCatalog(SAMPLE_CATALOG);

    // One batched INSERT ... ON CONFLICT DO UPDATE per table (category/metric/field) — never a
    // deleteMany() covering rows that are still present in the new catalog.
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it("only deletes rows that are genuinely absent from the new catalog, not the whole table", async () => {
    await replaceFilterCatalog(SAMPLE_CATALOG);

    expect(mockTx.filterCategory.deleteMany).toHaveBeenCalledWith({
      where: { key: { notIn: ["profitability", "guru"] } },
    });
    expect(mockTx.filterMetric.deleteMany).toHaveBeenCalledWith({
      where: { key: { notIn: ["eps", "grahamNumber"] } },
    });
    expect(mockTx.filterMetricField.deleteMany).toHaveBeenCalledWith({
      where: {
        NOT: {
          OR: [
            { metricKey: "eps", key: "epsQuarterly" },
            { metricKey: "eps", key: "epsTtm" },
            { metricKey: "grahamNumber", key: "grahamNumber" },
          ],
        },
      },
    });
  });

  it("deletes everything when the new catalog is empty, instead of leaving stale rows behind", async () => {
    await replaceFilterCatalog([]);

    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    expect(mockTx.filterMetricField.deleteMany).toHaveBeenCalledWith({ where: {} });
    expect(mockTx.filterMetric.deleteMany).toHaveBeenCalledWith({ where: { key: { notIn: [] } } });
    expect(mockTx.filterCategory.deleteMany).toHaveBeenCalledWith({ where: { key: { notIn: [] } } });
  });

  it("stays at a fixed number of queries no matter how many categories/metrics/fields there are", async () => {
    const bigCatalog: FilterCategory[] = Array.from({ length: 10 }, (_, categoryIndex) => ({
      key: `category${categoryIndex}`,
      name: `Category ${categoryIndex}`,
      sort: categoryIndex,
      metrics: Array.from({ length: 5 }, (_, metricIndex) => ({
        key: `category${categoryIndex}-metric${metricIndex}`,
        name: `Metric ${metricIndex}`,
        path: `/category${categoryIndex}/metric${metricIndex}`,
        sort: metricIndex,
        fields: Array.from({ length: 3 }, (_, fieldIndex) => ({
          key: `field${fieldIndex}`,
          name: `Field ${fieldIndex}`,
          period: "quarterly",
          sort: fieldIndex,
        })),
      })),
    }));

    await replaceFilterCatalog(bigCatalog);

    const totalCalls =
      mockTx.$executeRaw.mock.calls.length +
      mockTx.filterCategory.deleteMany.mock.calls.length +
      mockTx.filterMetric.deleteMany.mock.calls.length +
      mockTx.filterMetricField.deleteMany.mock.calls.length;

    expect(totalCalls).toBe(6);
  });
});
