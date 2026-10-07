import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemHealthPort } from "@/application/ports/systemHealth.js";
import { getHealthReport } from "@/application/system/system.service.js";

const STARTED_AT = new Date("2026-08-30T00:00:00.000Z");

/**
 * A fake port instead of `vi.mock` on the Prisma module or fetch. What the health check is actually
 * specified to do is "ask every dependency and report who answered" — the port says exactly that.
 */
function fakeSystemHealth(overrides: Partial<SystemHealthPort> = {}): SystemHealthPort {
  return {
    checkAppDatabase: vi.fn().mockResolvedValue(undefined),
    checkAnalysisService: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("getHealthReport", () => {
  it('reports "ok" when the app DB and analysis-ts both answer', async () => {
    const report = await getHealthReport(STARTED_AT, { systemHealth: fakeSystemHealth() });

    expect(report.status).toBe("ok");
    expect(report.dependencies.appDb.status).toBe("ok");
    expect(report.dependencies.analysisService.status).toBe("ok");
    expect(report.startedAt).toBe(STARTED_AT.toISOString());
  });

  it('reports "degraded" and names analysis-ts when only it fails', async () => {
    const systemHealth = fakeSystemHealth({ checkAnalysisService: vi.fn().mockRejectedValue(new Error("Could not reach the analysis service")) });

    const report = await getHealthReport(STARTED_AT, { systemHealth });

    expect(report.status).toBe("degraded");
    expect(report.dependencies.appDb.status).toBe("ok");
    expect(report.dependencies.analysisService).toMatchObject({ status: "error", error: "Could not reach the analysis service" });
  });

  it("treats a dependency that never resolves as a failure instead of hanging forever", async () => {
    vi.useFakeTimers();
    const systemHealth = fakeSystemHealth({ checkAnalysisService: vi.fn().mockImplementation(() => new Promise(() => {})) });

    const reportPromise = getHealthReport(STARTED_AT, { systemHealth });
    await vi.advanceTimersByTimeAsync(3_000);
    const report = await reportPromise;

    expect(report.dependencies.analysisService.error).toMatch(/timed out/);
  });

  it("5 秒內共用同一份報告，過了才重新探測", async () => {
    vi.useFakeTimers();
    const systemHealth = fakeSystemHealth();

    await getHealthReport(STARTED_AT, { systemHealth });
    await vi.advanceTimersByTimeAsync(4_999);
    await getHealthReport(STARTED_AT, { systemHealth });
    expect(systemHealth.checkAnalysisService).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await getHealthReport(STARTED_AT, { systemHealth });
    expect(systemHealth.checkAnalysisService).toHaveBeenCalledTimes(2);
  });
});
