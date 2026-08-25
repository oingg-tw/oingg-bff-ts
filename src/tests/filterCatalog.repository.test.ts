import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {
  filterCategory: { deleteMany: vi.fn(), createMany: vi.fn() },
  filterMetric: { createMany: vi.fn() },
  filterMetricField: { createMany: vi.fn() },
};

const mockPrisma = {
  $transaction: vi.fn(async (callback: (tx: typeof mockTx) => Promise<void>) => callback(mockTx)),
};

vi.mock("../adapters/neon/index.js", () => ({
  getPrismaClient: () => mockPrisma,
}));

import { replaceFilterCatalog } from "../domains/filterCatalog/filterCatalog.repository.js";
import type { FilterCategory } from "../domains/filterCatalog/filterCatalog.types.js";

// Regression test: replaceFilterCatalog used to loop a create() per category/metric/field inside
// the transaction — fine for a tiny catalog, but once the real catalog grew to dozens of metrics,
// the accumulated round-trips to a real (non-localhost) Neon connection blew past Prisma's 5s
// interactive-transaction timeout (P2028) and the whole sync failed. createMany per table keeps
// this at a fixed 4 queries no matter how large the catalog gets.
describe("replaceFilterCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wipes and bulk-inserts via createMany, not one create() per row", async () => {
    const categories: FilterCategory[] = [
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

    await replaceFilterCatalog(categories);

    expect(mockTx.filterCategory.deleteMany).toHaveBeenCalledOnce();
    expect(mockTx.filterCategory.createMany).toHaveBeenCalledOnce();
    expect(mockTx.filterMetric.createMany).toHaveBeenCalledOnce();
    expect(mockTx.filterMetricField.createMany).toHaveBeenCalledOnce();

    expect(mockTx.filterCategory.createMany).toHaveBeenCalledWith({
      data: [
        { key: "profitability", name: "Profitability" },
        { key: "guru", name: "Guru" },
      ],
    });

    expect(mockTx.filterMetric.createMany).toHaveBeenCalledWith({
      data: [
        { key: "eps", categoryKey: "profitability", name: "EPS", path: "/profitability/eps" },
        { key: "grahamNumber", categoryKey: "guru", name: "Graham Number", path: "/guru/graham-number" },
      ],
    });

    expect(mockTx.filterMetricField.createMany).toHaveBeenCalledWith({
      data: [
        { metricKey: "eps", key: "epsQuarterly", name: "EPS (quarterly)", period: "quarterly" },
        { metricKey: "eps", key: "epsTtm", name: "EPS (TTM)", period: "ttm" },
        { metricKey: "grahamNumber", key: "grahamNumber", name: "Graham Number", period: "ttm" },
      ],
    });
  });

  it("stays at a fixed 4 queries no matter how many categories/metrics/fields there are", async () => {
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
      mockTx.filterCategory.deleteMany.mock.calls.length +
      mockTx.filterCategory.createMany.mock.calls.length +
      mockTx.filterMetric.createMany.mock.calls.length +
      mockTx.filterMetricField.createMany.mock.calls.length;

    expect(totalCalls).toBe(4);
    expect(mockTx.filterMetric.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([]) });
    expect((mockTx.filterMetric.createMany.mock.calls[0]?.[0] as { data: unknown[] }).data).toHaveLength(50);
    expect((mockTx.filterMetricField.createMany.mock.calls[0]?.[0] as { data: unknown[] }).data).toHaveLength(150);
  });
});
