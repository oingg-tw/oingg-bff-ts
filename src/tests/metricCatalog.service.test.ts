import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domainBusiness/metricCatalog/metricCatalog.client.js", () => ({
  fetchMetricCatalog: vi.fn(),
}));

vi.mock("@/domainBusiness/metricCatalog/metricCatalog.repository.js", () => ({
  listMetricCatalog: vi.fn(),
  replaceMetricCatalog: vi.fn(),
}));

import { fetchMetricCatalog } from "@/domainBusiness/metricCatalog/metricCatalog.client.js";
import { replaceMetricCatalog } from "@/domainBusiness/metricCatalog/metricCatalog.repository.js";
import { startMetricCatalogSync, syncMetricCatalog } from "@/domainBusiness/metricCatalog/metricCatalog.service.js";

const SAMPLE_CATEGORY = { key: "profitability", name: "Profitability", sort: 0, metrics: [] };

describe("syncMetricCatalog", () => {
  beforeEach(() => {
    vi.mocked(fetchMetricCatalog).mockReset();
    vi.mocked(replaceMetricCatalog).mockReset();
  });

  // Regression (2026-09-08): analysis-ts's own /filters (since renamed /metrics) briefly returned
  // `categories: []` mid-migration. replaceMetricCatalog([]) would delete every
  // MetricCategory/MetricDefinition/MetricDefinitionField row, which cascades into ScreenerPresetFilter
  // and destroys every user's saved filter conditions — not just empties the catalog UI. Must refuse to
  // apply an empty catalog rather than treat it as valid data.
  it("throws and does not touch the local catalog when the upstream catalog is empty", async () => {
    vi.mocked(fetchMetricCatalog).mockResolvedValue([]);

    await expect(syncMetricCatalog()).rejects.toThrow(/empty catalog/);

    expect(replaceMetricCatalog).not.toHaveBeenCalled();
  });

  it("applies a non-empty catalog normally", async () => {
    vi.mocked(fetchMetricCatalog).mockResolvedValue([SAMPLE_CATEGORY]);

    const result = await syncMetricCatalog();

    expect(replaceMetricCatalog).toHaveBeenCalledWith([SAMPLE_CATEGORY]);
    expect(result).toEqual({ categoryCount: 1, metricCount: 0 });
  });
});

describe("startMetricCatalogSync", () => {
  beforeEach(() => {
    vi.mocked(fetchMetricCatalog).mockReset();
    vi.mocked(replaceMetricCatalog).mockReset();
  });

  // oingg-analysis-ts (數據中台) must never know oingg-bff-ts exists, so there is no push/notify
  // mechanism from their side — bff-ts is the only side that can keep this fresh, by pulling on its
  // own once at startup. Fire-and-forget: must never throw or block the caller.
  it("pulls the catalog from oingg-analysis-ts and replaces the local copy", async () => {
    vi.mocked(fetchMetricCatalog).mockResolvedValue([SAMPLE_CATEGORY]);

    startMetricCatalogSync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMetricCatalog).toHaveBeenCalledTimes(1);
    expect(replaceMetricCatalog).toHaveBeenCalledWith([SAMPLE_CATEGORY]);
  });

  it("retries once if the first attempt fails, without throwing", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchMetricCatalog).mockRejectedValueOnce(new Error("analysis-ts still booting"));
    vi.mocked(fetchMetricCatalog).mockResolvedValueOnce([SAMPLE_CATEGORY]);

    startMetricCatalogSync();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMetricCatalog).toHaveBeenCalledTimes(2);
    expect(replaceMetricCatalog).toHaveBeenCalledWith([SAMPLE_CATEGORY]);

    vi.useRealTimers();
  });

  it("treats an empty upstream catalog like a failed fetch — retries instead of applying it", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchMetricCatalog).mockResolvedValueOnce([]);
    vi.mocked(fetchMetricCatalog).mockResolvedValueOnce([SAMPLE_CATEGORY]);

    startMetricCatalogSync();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMetricCatalog).toHaveBeenCalledTimes(2);
    expect(replaceMetricCatalog).toHaveBeenCalledTimes(1);
    expect(replaceMetricCatalog).toHaveBeenCalledWith([SAMPLE_CATEGORY]);

    vi.useRealTimers();
  });

  it("gives up quietly (no throw) after the retry also fails", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchMetricCatalog).mockRejectedValue(new Error("still down"));

    expect(() => startMetricCatalogSync()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMetricCatalog).toHaveBeenCalledTimes(2);
    expect(replaceMetricCatalog).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
