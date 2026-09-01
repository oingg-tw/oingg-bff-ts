import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/adapters/neon/index.js", () => ({
  listNeonPoolNames: vi.fn(),
  queryNeon: vi.fn(),
  getPrismaClient: vi.fn(),
}));

import { getPrismaClient, listNeonPoolNames, queryNeon } from "@/adapters/neon/index.js";
import { getHealthReport } from "@/domains/system/system.service.js";

const STARTED_AT = new Date("2026-08-30T00:00:00.000Z");

function mockPrisma(queryRawImpl: () => Promise<unknown>) {
  vi.mocked(getPrismaClient).mockReturnValue({ $queryRaw: queryRawImpl } as never);
}

describe("getHealthReport", () => {
  beforeEach(() => {
    vi.mocked(listNeonPoolNames).mockReset();
    vi.mocked(queryNeon).mockReset();
    vi.mocked(getPrismaClient).mockReset();
  });

  it('reports "ok" when every Neon pool and the app DB all answer successfully', async () => {
    vi.mocked(listNeonPoolNames).mockReturnValue(["twse", "tpex"]);
    vi.mocked(queryNeon).mockResolvedValue({ rows: [{ "?column?": 1 }] } as never);
    mockPrisma(async () => [{ "?column?": 1 }]);

    const report = await getHealthReport(STARTED_AT);

    expect(report.status).toBe("ok");
    expect(report.dependencies.neon.twse?.status).toBe("ok");
    expect(report.dependencies.neon.tpex?.status).toBe("ok");
    expect(report.dependencies.appDb.status).toBe("ok");
    expect(report.startedAt).toBe(STARTED_AT.toISOString());
  });

  it('reports "degraded" and names the specific failing pool when one Neon pool fails', async () => {
    vi.mocked(listNeonPoolNames).mockReturnValue(["twse", "tpex"]);
    vi.mocked(queryNeon).mockImplementation(async (name) => {
      if (name === "tpex") {
        throw new Error("connection refused");
      }
      return { rows: [{ "?column?": 1 }] } as never;
    });
    mockPrisma(async () => [{ "?column?": 1 }]);

    const report = await getHealthReport(STARTED_AT);

    expect(report.status).toBe("degraded");
    expect(report.dependencies.neon.twse?.status).toBe("ok");
    expect(report.dependencies.neon.tpex).toMatchObject({ status: "error", error: "connection refused" });
  });

  it('reports "degraded" when the app DB itself fails, even if every Neon pool is fine', async () => {
    vi.mocked(listNeonPoolNames).mockReturnValue(["twse"]);
    vi.mocked(queryNeon).mockResolvedValue({ rows: [{ "?column?": 1 }] } as never);
    mockPrisma(async () => {
      throw new Error("app db unreachable");
    });

    const report = await getHealthReport(STARTED_AT);

    expect(report.status).toBe("degraded");
    expect(report.dependencies.appDb).toMatchObject({ status: "error", error: "app db unreachable" });
  });

  it("treats a dependency that never resolves as a failure instead of hanging forever", async () => {
    vi.useFakeTimers();
    vi.mocked(listNeonPoolNames).mockReturnValue(["twse"]);
    vi.mocked(queryNeon).mockImplementation(() => new Promise(() => {})); // never resolves
    mockPrisma(async () => [{ "?column?": 1 }]);

    const reportPromise = getHealthReport(STARTED_AT);
    await vi.advanceTimersByTimeAsync(3_000);
    const report = await reportPromise;

    expect(report.dependencies.neon.twse?.status).toBe("error");
    expect(report.dependencies.neon.twse?.error).toMatch(/timed out/);

    vi.useRealTimers();
  });
});
