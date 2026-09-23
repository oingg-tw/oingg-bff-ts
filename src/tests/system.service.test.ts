import { describe, expect, it, vi } from "vitest";
import type { SystemHealthPort } from "@/application/ports/systemHealth.js";
import { getHealthReport } from "@/application/system/system.service.js";

const STARTED_AT = new Date("2026-08-30T00:00:00.000Z");

/**
 * A fake port instead of `vi.mock` on the Prisma/pg module. What the health check is actually specified
 * to do is "ask every dependency and report who answered" — the port says exactly that, so these tests
 * no longer have to stand up a fake PrismaClient with a `$queryRaw` just to express "the app DB is
 * down". Which query gets sent, and to which driver, is the adapter's business now.
 */
function fakeSystemHealth(overrides: Partial<SystemHealthPort> = {}): SystemHealthPort {
  return {
    listPoolNames: vi.fn().mockReturnValue([]),
    checkPool: vi.fn().mockResolvedValue(undefined),
    checkAppDatabase: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("getHealthReport", () => {
  it('reports "ok" when every Neon pool and the app DB all answer successfully', async () => {
    const systemHealth = fakeSystemHealth({ listPoolNames: vi.fn().mockReturnValue(["twse", "tpex"]) });

    const report = await getHealthReport(STARTED_AT, { systemHealth });

    expect(report.status).toBe("ok");
    expect(report.dependencies.neon.twse?.status).toBe("ok");
    expect(report.dependencies.neon.tpex?.status).toBe("ok");
    expect(report.dependencies.appDb.status).toBe("ok");
    expect(report.startedAt).toBe(STARTED_AT.toISOString());
  });

  it('reports "degraded" and names the specific failing pool when one Neon pool fails', async () => {
    const systemHealth = fakeSystemHealth({
      listPoolNames: vi.fn().mockReturnValue(["twse", "tpex"]),
      checkPool: vi.fn().mockImplementation(async (name: string) => {
        if (name === "tpex") {
          throw new Error("connection refused");
        }
      }),
    });

    const report = await getHealthReport(STARTED_AT, { systemHealth });

    expect(report.status).toBe("degraded");
    expect(report.dependencies.neon.twse?.status).toBe("ok");
    expect(report.dependencies.neon.tpex).toMatchObject({ status: "error", error: "connection refused" });
  });

  it('reports "degraded" when the app DB itself fails, even if every Neon pool is fine', async () => {
    const systemHealth = fakeSystemHealth({
      listPoolNames: vi.fn().mockReturnValue(["twse"]),
      checkAppDatabase: vi.fn().mockRejectedValue(new Error("app db unreachable")),
    });

    const report = await getHealthReport(STARTED_AT, { systemHealth });

    expect(report.status).toBe("degraded");
    expect(report.dependencies.appDb).toMatchObject({ status: "error", error: "app db unreachable" });
  });

  it("treats a dependency that never resolves as a failure instead of hanging forever", async () => {
    vi.useFakeTimers();
    const systemHealth = fakeSystemHealth({
      listPoolNames: vi.fn().mockReturnValue(["twse"]),
      checkPool: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
    });

    const reportPromise = getHealthReport(STARTED_AT, { systemHealth });
    await vi.advanceTimersByTimeAsync(3_000);
    const report = await reportPromise;

    expect(report.dependencies.neon.twse?.status).toBe("error");
    expect(report.dependencies.neon.twse?.error).toMatch(/timed out/);

    vi.useRealTimers();
  });
});
