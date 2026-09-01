import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/companies/companies.client.js", () => ({
  fetchCompanies: vi.fn(),
}));

import { fetchCompanies } from "../domains/companies/companies.client.js";
import { getCompanyNames } from "../domains/companies/companies.service.js";

const ALL_COMPANIES = [
  { companyId: "2330", companyName: "台積電" },
  { companyId: "2317", companyName: "鴻海" },
  { companyId: "9999", companyName: null },
];

beforeEach(() => {
  vi.mocked(fetchCompanies).mockReset();
});

describe("getCompanyNames", () => {
  it("returns an empty map without calling fetchCompanies when given no symbols", async () => {
    const result = await getCompanyNames([]);

    expect(result).toEqual(new Map());
    expect(fetchCompanies).not.toHaveBeenCalled();
  });

  it("live-fetches the full company list and filters it down to only the requested symbols", async () => {
    vi.mocked(fetchCompanies).mockResolvedValue(ALL_COMPANIES);

    const result = await getCompanyNames(["2330", "9999"]);

    expect(result).toEqual(
      new Map([
        ["2330", "台積電"],
        ["9999", null],
      ]),
    );
    // 2317 was fetched (analysis-ts has no filtered endpoint) but must not appear in the result — nothing
    // beyond what was actually asked for is kept.
    expect(result.has("2317")).toBe(false);
  });

  it("omits a requested symbol entirely when analysis-ts doesn't know about it", async () => {
    vi.mocked(fetchCompanies).mockResolvedValue(ALL_COMPANIES);

    const result = await getCompanyNames(["2330", "not-a-real-symbol"]);

    expect(result.has("not-a-real-symbol")).toBe(false);
    expect(result.get("2330")).toBe("台積電");
  });

  // This is the core architectural point: no bff-owned copy of market data survives past one call.
  it("hits fetchCompanies again on every call, holding nothing over from a previous lookup", async () => {
    vi.mocked(fetchCompanies).mockResolvedValue(ALL_COMPANIES);

    await getCompanyNames(["2330"]);
    await getCompanyNames(["2317"]);

    expect(fetchCompanies).toHaveBeenCalledTimes(2);
  });
});
