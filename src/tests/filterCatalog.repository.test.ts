import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {
  $executeRaw: vi.fn(async () => 0),
  filterCategory: { deleteMany: vi.fn() },
  filterMetric: { deleteMany: vi.fn() },
  filterMetricField: { deleteMany: vi.fn() },
};

const mockPrisma = {
  $transaction: vi.fn(async (callback: (tx: typeof mockTx) => Promise<void>) => callback(mockTx)),
};

vi.mock("../adapters/neon/index.js", () => ({
  getPrismaClient: () => mockPrisma,
}));

import { replaceFilterCatalog } from "../domains/filterCatalog/filterCatalog.repository.js";
import type { FilterCategory } from "../domains/filterCatalog/filterCatalog.types.js";

const SAMPLE_CATALOG: FilterCategory[] = [
  {
    key: "profitability",
    name: "Profitability",
    metrics: [
      {
        key: "eps",
        name: "EPS",
        path: "/profitability/eps",
        fields: [
          { key: "epsQuarterly", name: "EPS (quarterly)", period: "quarterly" },
          { key: "epsTtm", name: "EPS (TTM)", period: "ttm" },
        ],
      },
    ],
  },
  {
    key: "guru",
    name: "Guru",
    metrics: [
      {
        key: "grahamNumber",
        name: "Graham Number",
        path: "/guru/graham-number",
        fields: [{ key: "grahamNumber", name: "Graham Number", period: "ttm" }],
      },
    ],
  },
];

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
      metrics: Array.from({ length: 5 }, (_, metricIndex) => ({
        key: `category${categoryIndex}-metric${metricIndex}`,
        name: `Metric ${metricIndex}`,
        path: `/category${categoryIndex}/metric${metricIndex}`,
        fields: Array.from({ length: 3 }, (_, fieldIndex) => ({
          key: `field${fieldIndex}`,
          name: `Field ${fieldIndex}`,
          period: "quarterly",
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
