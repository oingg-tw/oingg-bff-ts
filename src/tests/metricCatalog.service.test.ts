import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MetricCatalogPort } from "@/application/ports/metricCatalog.js";
import type { MetricCatalogGatewayPort } from "@/application/ports/metricCatalogGateway.js";
import type { MetricCategory } from "@/application/metricCatalog/metricCatalog.types.js";
import { fakeMetricCatalog } from "@/tests/fakes/metricCatalog.js";
import {
  startMetricCatalogSync,
  syncMetricCatalog,
  type MetricCatalogSyncDeps,
} from "@/application/metricCatalog/metricCatalog.service.js";

const SAMPLE_CATEGORY: MetricCategory = { key: "profitability", name: "Profitability", sort: 0, metrics: [] };

/**
 * Fake ports instead of `vi.mock` on the repository and the HTTP client. This slice is the one place
 * with a port on each side, and the sync rule below is precisely a rule about how the two relate — so
 * the test now states that relationship ("never call replace with what the gateway returned, if it
 * returned nothing") rather than which modules happen to implement each side.
 */
function fakeDeps(gateway: Partial<MetricCatalogGatewayPort> = {}): MetricCatalogSyncDeps {
  const metricCatalog: MetricCatalogPort = fakeMetricCatalog();
  const metricCatalogGateway: MetricCatalogGatewayPort = {
    fetchCatalog: vi.fn().mockResolvedValue([SAMPLE_CATEGORY]),
    ...gateway,
  };
  return { metricCatalog, metricCatalogGateway };
}

describe("syncMetricCatalog", () => {
  // Regression (2026-09-08): analysis-ts's own /filters (since renamed /metrics) briefly returned
  // `categories: []` mid-migration. metricCatalog.replace([]) would delete every
  // MetricCategory/MetricDefinition/MetricDefinitionField row, which cascades into ScreenerPresetFilter
  // and destroys every user's saved filter conditions — not just empties the catalog UI. Must refuse to
  // apply an empty catalog rather than treat it as valid data.
  it("throws and does not touch the local catalog when the upstream catalog is empty", async () => {
    const deps = fakeDeps({ fetchCatalog: vi.fn().mockResolvedValue([]) });

    await expect(syncMetricCatalog(deps)).rejects.toThrow(/empty catalog/);

    expect(deps.metricCatalog.replace).not.toHaveBeenCalled();
  });

  it("applies a non-empty catalog normally", async () => {
    const deps = fakeDeps();

    const result = await syncMetricCatalog(deps);

    expect(deps.metricCatalog.replace).toHaveBeenCalledWith([SAMPLE_CATEGORY]);
    expect(result).toEqual({ categoryCount: 1, metricCount: 0 });
  });
});

describe("startMetricCatalogSync", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  // oingg-analysis-ts (數據中台) must never know oingg-bff-ts exists, so there is no push/notify
  // mechanism from their side — bff-ts is the only side that can keep this fresh, by pulling on its
  // own once at startup. Fire-and-forget: must never throw or block the caller.
  it("pulls the catalog from oingg-analysis-ts and replaces the local copy", async () => {
    const deps = fakeDeps();

    startMetricCatalogSync(deps);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.metricCatalogGateway.fetchCatalog).toHaveBeenCalledTimes(1);
    expect(deps.metricCatalog.replace).toHaveBeenCalledWith([SAMPLE_CATEGORY]);
  });

  it("retries once if the first attempt fails, without throwing", async () => {
    vi.useFakeTimers();
    const deps = fakeDeps({
      fetchCatalog: vi
        .fn()
        .mockRejectedValueOnce(new Error("analysis-ts still booting"))
        .mockResolvedValueOnce([SAMPLE_CATEGORY]),
    });

    startMetricCatalogSync(deps);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(deps.metricCatalogGateway.fetchCatalog).toHaveBeenCalledTimes(2);
    expect(deps.metricCatalog.replace).toHaveBeenCalledWith([SAMPLE_CATEGORY]);

    vi.useRealTimers();
  });

  it("treats an empty upstream catalog like a failed fetch — retries instead of applying it", async () => {
    vi.useFakeTimers();
    const deps = fakeDeps({
      fetchCatalog: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([SAMPLE_CATEGORY]),
    });

    startMetricCatalogSync(deps);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(deps.metricCatalogGateway.fetchCatalog).toHaveBeenCalledTimes(2);
    expect(deps.metricCatalog.replace).toHaveBeenCalledTimes(1);
    expect(deps.metricCatalog.replace).toHaveBeenCalledWith([SAMPLE_CATEGORY]);

    vi.useRealTimers();
  });

  it("gives up quietly (no throw) after the retry also fails", async () => {
    vi.useFakeTimers();
    const deps = fakeDeps({ fetchCatalog: vi.fn().mockRejectedValue(new Error("still down")) });

    expect(() => startMetricCatalogSync(deps)).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(deps.metricCatalogGateway.fetchCatalog).toHaveBeenCalledTimes(2);
    expect(deps.metricCatalog.replace).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
