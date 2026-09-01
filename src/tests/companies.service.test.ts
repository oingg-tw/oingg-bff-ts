import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/companies/companies.client.js", () => ({
  fetchCompanies: vi.fn(),
}));

vi.mock("@/domains/companies/companies.repository.js", () => ({
  findCompanyNames: vi.fn(),
  getCompaniesSyncedAt: vi.fn(),
  replaceCompanies: vi.fn(),
}));

import { fetchCompanies } from "@/domains/companies/companies.client.js";
import {
  findCompanyNames,
  getCompaniesSyncedAt,
  replaceCompanies,
} from "@/domains/companies/companies.repository.js";
import { getCompanyNames, syncCompanies, syncCompaniesIfStale } from "@/domains/companies/companies.service.js";

const ALL_COMPANIES = [
  { companyId: "2330", companyName: "台積電" },
  { companyId: "2317", companyName: "鴻海" },
];

beforeEach(() => {
  vi.mocked(fetchCompanies).mockReset();
  vi.mocked(findCompanyNames).mockReset();
  vi.mocked(getCompaniesSyncedAt).mockReset();
  vi.mocked(replaceCompanies).mockReset();
});

describe("getCompanyNames", () => {
  it("reads from the local cache (repository), not a live fetch", async () => {
    vi.mocked(findCompanyNames).mockResolvedValue(new Map([["2330", "台積電"]]));

    const result = await getCompanyNames(["2330"]);

    expect(result).toEqual(new Map([["2330", "台積電"]]));
    expect(findCompanyNames).toHaveBeenCalledWith(["2330"]);
    expect(fetchCompanies).not.toHaveBeenCalled();
  });
});

describe("syncCompanies", () => {
  it("fetches from analysis-ts and replaces the cached table", async () => {
    vi.mocked(fetchCompanies).mockResolvedValue(ALL_COMPANIES);
    vi.mocked(replaceCompanies).mockResolvedValue(undefined);

    const summary = await syncCompanies();

    expect(replaceCompanies).toHaveBeenCalledWith(ALL_COMPANIES);
    expect(summary).toEqual({ companyCount: 2 });
  });
});

describe("syncCompaniesIfStale", () => {
  it("syncs when the cache has never been synced (null syncedAt)", async () => {
    vi.mocked(getCompaniesSyncedAt).mockResolvedValue(null);
    vi.mocked(fetchCompanies).mockResolvedValue(ALL_COMPANIES);
    vi.mocked(replaceCompanies).mockResolvedValue(undefined);

    const result = await syncCompaniesIfStale();

    expect(fetchCompanies).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ companyCount: 2 });
  });

  it("skips syncing when the cache was synced less than 24h ago", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    vi.mocked(getCompaniesSyncedAt).mockResolvedValue(oneHourAgo);

    const result = await syncCompaniesIfStale();

    expect(fetchCompanies).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  // Regression-shaped: this is the whole point of persisting syncedAt in the DB rather than an
  // in-memory flag — a restart 23 hours in must not re-trigger a sync just because the process is new.
  it("still skips syncing when synced 23h59m ago, right at the edge of the freshness window", async () => {
    const almost24hAgo = new Date(Date.now() - (24 * 60 * 60 * 1000 - 60_000));
    vi.mocked(getCompaniesSyncedAt).mockResolvedValue(almost24hAgo);

    await syncCompaniesIfStale();

    expect(fetchCompanies).not.toHaveBeenCalled();
  });

  it("syncs again once more than 24h have passed since the last sync", async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    vi.mocked(getCompaniesSyncedAt).mockResolvedValue(twentyFiveHoursAgo);
    vi.mocked(fetchCompanies).mockResolvedValue(ALL_COMPANIES);
    vi.mocked(replaceCompanies).mockResolvedValue(undefined);

    const result = await syncCompaniesIfStale();

    expect(fetchCompanies).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ companyCount: 2 });
  });
});
