import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEtfScreenerGateway } from "@/tests/fakes/analysisGateways.js";
import { runEtfScreener } from "@/application/proxy/etfScreener/etfScreener.service.js";

/**
 * A fake port instead of `vi.mock` on the client module. This service has exactly one rule of its own
 * ("filters or columns must have at least one item"), so what these tests need to observe is whether the
 * gateway was reached at all — and being typed as EtfScreenerGatewayPort keeps the fake from drifting.
 *
 * getEtfFieldCatalog used to have a test here asserting it delegated straight through. It was deleted
 * along with the function: that endpoint has no local rule to enforce, so the route now calls the
 * gateway port directly and there is no bff-ts behaviour left to assert.
 */
let etfScreenerGateway = fakeEtfScreenerGateway();
let deps = { etfScreenerGateway };

beforeEach(() => {
  etfScreenerGateway = fakeEtfScreenerGateway();
  deps = { etfScreenerGateway };
});

describe("runEtfScreener", () => {
  it("rejects when both filters and columns are empty, without calling analysis-ts", async () => {
    await expect(runEtfScreener([], [], 1, 50, undefined, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(etfScreenerGateway.runScreener).not.toHaveBeenCalled();
  });

  it("allows empty filters when columns are given (list-everything mode)", async () => {
    vi.mocked(etfScreenerGateway.runScreener).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

    await runEtfScreener([], [{ field: "aum" }], 1, 50, undefined, deps);

    expect(etfScreenerGateway.runScreener).toHaveBeenCalledWith([], [{ field: "aum" }], 1, 50, undefined);
  });

  it("allows empty columns when filters are given", async () => {
    vi.mocked(etfScreenerGateway.runScreener).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

    await runEtfScreener([{ field: "market", values: ["TWSE"] }], [], 1, 50, undefined, deps);

    expect(etfScreenerGateway.runScreener).toHaveBeenCalledWith([{ field: "market", values: ["TWSE"] }], [], 1, 50, undefined);
  });

  it("passes sort through when given", async () => {
    vi.mocked(etfScreenerGateway.runScreener).mockResolvedValue({ count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] });

    await runEtfScreener([], [{ field: "aum" }], 2, 25, { field: "aum", order: "desc" }, deps);

    expect(etfScreenerGateway.runScreener).toHaveBeenCalledWith([], [{ field: "aum" }], 2, 25, { field: "aum", order: "desc" });
  });
});
