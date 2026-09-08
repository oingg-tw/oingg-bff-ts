import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domainBusiness/filterCatalog/filterCatalog.client.js", () => ({
  fetchFilterCatalog: vi.fn(),
}));

vi.mock("@/domainBusiness/filterCatalog/filterCatalog.repository.js", () => ({
  listFilterCatalog: vi.fn(),
  replaceFilterCatalog: vi.fn(),
}));

import { fetchFilterCatalog } from "@/domainBusiness/filterCatalog/filterCatalog.client.js";
import { replaceFilterCatalog } from "@/domainBusiness/filterCatalog/filterCatalog.repository.js";
import { startFilterCatalogSync, syncFilterCatalog } from "@/domainBusiness/filterCatalog/filterCatalog.service.js";

const SAMPLE_CATEGORY = { key: "profitability", name: "Profitability", sort: 0, metrics: [] };

describe("syncFilterCatalog", () => {
  beforeEach(() => {
    vi.mocked(fetchFilterCatalog).mockReset();
    vi.mocked(replaceFilterCatalog).mockReset();
  });

  // Regression (2026-09-08): analysis-ts's own /filters briefly returned `categories: []` mid-migration.
  // replaceFilterCatalog([]) would delete every FilterCategory/FilterMetric/FilterMetricField row, which
  // cascades into ScreenerPresetFilter and destroys every user's saved filter conditions — not just
  // empties the catalog UI. Must refuse to apply an empty catalog rather than treat it as valid data.
  it("throws and does not touch the local catalog when the upstream catalog is empty", async () => {
    vi.mocked(fetchFilterCatalog).mockResolvedValue([]);

    await expect(syncFilterCatalog()).rejects.toThrow(/empty catalog/);

    expect(replaceFilterCatalog).not.toHaveBeenCalled();
  });

  it("applies a non-empty catalog normally", async () => {
    vi.mocked(fetchFilterCatalog).mockResolvedValue([SAMPLE_CATEGORY]);

    const result = await syncFilterCatalog();

    expect(replaceFilterCatalog).toHaveBeenCalledWith([SAMPLE_CATEGORY]);
    expect(result).toEqual({ categoryCount: 1, metricCount: 0 });
  });
});

describe("startFilterCatalogSync", () => {
  beforeEach(() => {
    vi.mocked(fetchFilterCatalog).mockReset();
    vi.mocked(replaceFilterCatalog).mockReset();
  });

  // oingg-analysis-ts (數據中台) must never know oingg-bff-ts exists, so there is no push/notify
  // mechanism from their side — bff-ts is the only side that can keep this fresh, by pulling on its
  // own once at startup. Fire-and-forget: must never throw or block the caller.
  it("pulls the catalog from oingg-analysis-ts and replaces the local copy", async () => {
    vi.mocked(fetchFilterCatalog).mockResolvedValue([SAMPLE_CATEGORY]);

    startFilterCatalogSync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchFilterCatalog).toHaveBeenCalledTimes(1);
    expect(replaceFilterCatalog).toHaveBeenCalledWith([SAMPLE_CATEGORY]);
  });

  it("retries once if the first attempt fails, without throwing", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchFilterCatalog).mockRejectedValueOnce(new Error("analysis-ts still booting"));
    vi.mocked(fetchFilterCatalog).mockResolvedValueOnce([SAMPLE_CATEGORY]);

    startFilterCatalogSync();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchFilterCatalog).toHaveBeenCalledTimes(2);
    expect(replaceFilterCatalog).toHaveBeenCalledWith([SAMPLE_CATEGORY]);

    vi.useRealTimers();
  });

  it("treats an empty upstream catalog like a failed fetch — retries instead of applying it", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchFilterCatalog).mockResolvedValueOnce([]);
    vi.mocked(fetchFilterCatalog).mockResolvedValueOnce([SAMPLE_CATEGORY]);

    startFilterCatalogSync();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchFilterCatalog).toHaveBeenCalledTimes(2);
    expect(replaceFilterCatalog).toHaveBeenCalledTimes(1);
    expect(replaceFilterCatalog).toHaveBeenCalledWith([SAMPLE_CATEGORY]);

    vi.useRealTimers();
  });

  it("gives up quietly (no throw) after the retry also fails", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchFilterCatalog).mockRejectedValue(new Error("still down"));

    expect(() => startFilterCatalogSync()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchFilterCatalog).toHaveBeenCalledTimes(2);
    expect(replaceFilterCatalog).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
