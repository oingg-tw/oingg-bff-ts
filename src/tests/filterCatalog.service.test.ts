import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/filterCatalog/filterCatalog.client.js", () => ({
  fetchFilterCatalog: vi.fn(),
}));

vi.mock("../domains/filterCatalog/filterCatalog.repository.js", () => ({
  listFilterCatalog: vi.fn(),
  replaceFilterCatalog: vi.fn(),
}));

import { fetchFilterCatalog } from "../domains/filterCatalog/filterCatalog.client.js";
import { listFilterCatalog, replaceFilterCatalog } from "../domains/filterCatalog/filterCatalog.repository.js";
import { bootstrapFilterCatalogIfEmpty } from "../domains/filterCatalog/filterCatalog.service.js";

const SAMPLE_CATEGORY = { key: "profitability", name: "Profitability", metrics: [] };

describe("bootstrapFilterCatalogIfEmpty", () => {
  beforeEach(() => {
    vi.mocked(fetchFilterCatalog).mockReset();
    vi.mocked(listFilterCatalog).mockReset();
    vi.mocked(replaceFilterCatalog).mockReset();
  });

  // Regression: this used to run unconditionally on every server restart. oingg-analysis-ts now pushes
  // updates via POST /filters/sync instead — a restart with an already-populated local catalog must not
  // re-pull on its own anymore, or the two mechanisms would just duplicate the same round trip.
  it("does not sync when the local catalog already has data", async () => {
    vi.mocked(listFilterCatalog).mockResolvedValue([SAMPLE_CATEGORY]);

    await bootstrapFilterCatalogIfEmpty();
    // The retry/fire-and-forget sync path is async internally — flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchFilterCatalog).not.toHaveBeenCalled();
    expect(replaceFilterCatalog).not.toHaveBeenCalled();
  });

  it("runs a one-time sync when the local catalog is empty (fresh deployment)", async () => {
    vi.mocked(listFilterCatalog).mockResolvedValue([]);
    vi.mocked(fetchFilterCatalog).mockResolvedValue([SAMPLE_CATEGORY]);

    await bootstrapFilterCatalogIfEmpty();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchFilterCatalog).toHaveBeenCalledTimes(1);
    expect(replaceFilterCatalog).toHaveBeenCalledWith([SAMPLE_CATEGORY]);
  });

  // The emptiness check itself hits our own DB before the server has even started listening — a
  // transient failure there must not crash startup, same fire-and-forget spirit as the sync it gates.
  it("never throws, even if checking the local catalog itself fails", async () => {
    vi.mocked(listFilterCatalog).mockRejectedValue(new Error("DB unreachable"));

    await expect(bootstrapFilterCatalogIfEmpty()).resolves.toBeUndefined();
    expect(fetchFilterCatalog).not.toHaveBeenCalled();
  });
});
