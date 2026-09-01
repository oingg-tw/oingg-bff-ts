import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {
  $executeRaw: vi.fn(async () => 0),
  company: { deleteMany: vi.fn() },
  companySyncState: { upsert: vi.fn() },
};

const mockPrisma = {
  $transaction: vi.fn(async (callback: (tx: typeof mockTx) => Promise<void>) => callback(mockTx)),
  company: { findMany: vi.fn() },
  companySyncState: { findUnique: vi.fn() },
};

vi.mock("../adapters/neon/index.js", () => ({
  getPrismaClient: () => mockPrisma,
}));

import {
  findCompanyNames,
  getCompaniesSyncedAt,
  replaceCompanies,
} from "../domains/companies/companies.repository.js";
import type { Company } from "../domains/companies/companies.types.js";

const SAMPLE_COMPANIES: Company[] = [
  { companyId: "2330", companyName: "台積電" },
  { companyId: "2317", companyName: "鴻海" },
  { companyId: "9999", companyName: null },
];

describe("findCompanyNames", () => {
  beforeEach(() => {
    vi.mocked(mockPrisma.company.findMany).mockReset();
  });

  it("returns an empty map without querying when given no companyIds", async () => {
    const result = await findCompanyNames([]);

    expect(result).toEqual(new Map());
    expect(mockPrisma.company.findMany).not.toHaveBeenCalled();
  });

  it("maps found rows into a Map keyed by companyId", async () => {
    vi.mocked(mockPrisma.company.findMany).mockResolvedValue([
      { companyId: "2330", companyName: "台積電" },
      { companyId: "9999", companyName: null },
    ] as never);

    const result = await findCompanyNames(["2330", "9999", "not-cached"]);

    expect(mockPrisma.company.findMany).toHaveBeenCalledWith({
      where: { companyId: { in: ["2330", "9999", "not-cached"] } },
    });
    expect(result).toEqual(
      new Map([
        ["2330", "台積電"],
        ["9999", null],
      ]),
    );
    expect(result.has("not-cached")).toBe(false);
  });
});

describe("getCompaniesSyncedAt", () => {
  beforeEach(() => {
    vi.mocked(mockPrisma.companySyncState.findUnique).mockReset();
  });

  it("returns null when never synced", async () => {
    vi.mocked(mockPrisma.companySyncState.findUnique).mockResolvedValue(null);
    await expect(getCompaniesSyncedAt()).resolves.toBeNull();
  });

  it("returns the stored syncedAt, queried by the fixed singleton id", async () => {
    const syncedAt = new Date("2026-09-01T00:00:00.000Z");
    vi.mocked(mockPrisma.companySyncState.findUnique).mockResolvedValue({ id: 1, syncedAt } as never);

    const result = await getCompaniesSyncedAt();

    expect(mockPrisma.companySyncState.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(result).toEqual(syncedAt);
  });
});

describe("replaceCompanies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts via a single batched statement instead of wiping and recreating every row", async () => {
    await replaceCompanies(SAMPLE_COMPANIES);

    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("only deletes rows genuinely absent from the new list, not the whole table", async () => {
    await replaceCompanies(SAMPLE_COMPANIES);

    expect(mockTx.company.deleteMany).toHaveBeenCalledWith({
      where: { companyId: { notIn: ["2330", "2317", "9999"] } },
    });
  });

  // The core reason replaceCompanies exists as one transaction: a crash between updating the rows and
  // stamping the sync timestamp must never leave "fresh data, stale timestamp" (would sync again
  // needlessly) or "stale data, fresh timestamp" (would wrongly skip a real sync for 24h).
  it("stamps CompanySyncState with the current time in the same transaction", async () => {
    await replaceCompanies(SAMPLE_COMPANIES);

    expect(mockTx.companySyncState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        create: expect.objectContaining({ id: 1 }),
        update: expect.any(Object),
      }),
    );
  });

  it("deletes everything and still stamps the sync time when the new list is empty", async () => {
    await replaceCompanies([]);

    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    expect(mockTx.company.deleteMany).toHaveBeenCalledWith({ where: { companyId: { notIn: [] } } });
    expect(mockTx.companySyncState.upsert).toHaveBeenCalled();
  });
});
