import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/etfScreener/etfScreener.client.js", () => ({
  fetchEtfFilterCatalog: vi.fn(),
  fetchEtfScreenerResults: vi.fn(),
}));

import { fetchEtfFilterCatalog, fetchEtfScreenerResults } from "@/domains/etfScreener/etfScreener.client.js";
import { getEtfFilterCatalog, runEtfScreener } from "@/domains/etfScreener/etfScreener.service.js";

beforeEach(() => {
  vi.mocked(fetchEtfFilterCatalog).mockReset();
  vi.mocked(fetchEtfScreenerResults).mockReset();
});

describe("getEtfFilterCatalog", () => {
  it("delegates straight through", async () => {
    vi.mocked(fetchEtfFilterCatalog).mockResolvedValue({ fields: [] });

    await getEtfFilterCatalog();

    expect(fetchEtfFilterCatalog).toHaveBeenCalledWith();
  });
});

describe("runEtfScreener", () => {
  it("rejects when both filters and columns are empty, without calling analysis-ts", async () => {
    await expect(runEtfScreener([], [], 1, 50)).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchEtfScreenerResults).not.toHaveBeenCalled();
  });

  it("allows empty filters when columns are given (list-everything mode)", async () => {
    vi.mocked(fetchEtfScreenerResults).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

    await runEtfScreener([], [{ field: "aum" }], 1, 50);

    expect(fetchEtfScreenerResults).toHaveBeenCalledWith([], [{ field: "aum" }], 1, 50, undefined);
  });

  it("allows empty columns when filters are given", async () => {
    vi.mocked(fetchEtfScreenerResults).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

    await runEtfScreener([{ field: "market", values: ["TWSE"] }], [], 1, 50);

    expect(fetchEtfScreenerResults).toHaveBeenCalledWith([{ field: "market", values: ["TWSE"] }], [], 1, 50, undefined);
  });

  it("passes sort through when given", async () => {
    vi.mocked(fetchEtfScreenerResults).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

    await runEtfScreener([], [{ field: "aum" }], 2, 25, { field: "aum", order: "desc" });

    expect(fetchEtfScreenerResults).toHaveBeenCalledWith([], [{ field: "aum" }], 2, 25, { field: "aum", order: "desc" });
  });
});
