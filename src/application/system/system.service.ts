import type { AppDeps } from "@/application/deps.js";

const CHECK_TIMEOUT_MS = 3_000;
/**
 * web-nuxt 的讀取失敗對話框會輪詢這支（經由它自己的 /api/system-health）。每個瀏覽器分頁都在輪詢時，不快取
 * 就等於每次都替每個分頁去敲一次 app DB 和 analysis-ts——5 秒內共用同一份報告（2026-10-08，跟 web-nuxt 約定）。
 */
const REPORT_TTL_MS = 5_000;
let cached: { at: number; report: Promise<HealthReport> } | null = null;

export function resetHealthReportCache(): void {
  cached = null;
}

export type SystemDeps = Pick<AppDeps, "systemHealth">;

export interface DependencyStatus {
  status: "ok" | "error";
  latencyMs?: number;
  error?: string;
}

export interface HealthReport {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  startedAt: string;
  dependencies: {
    appDb: DependencyStatus;
    analysisService: DependencyStatus;
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function checkDependency(probe: () => Promise<unknown>): Promise<DependencyStatus> {
  const start = performance.now();
  try {
    await withTimeout(probe(), CHECK_TIMEOUT_MS);
    return { status: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Actually exercises both dependencies this service needs to function — a minimal query against the
 * Prisma-managed app DB and a liveness ping to analysis-ts — rather than just reporting "the process is
 * alive". `status: "degraded"`
 * means at least one dependency failed; callers (frontend, conductor) can also check per-dependency
 * detail to see exactly which one.
 *
 * What the probes are made of is the port's business (`SELECT 1`, which analysis-ts path); what counts as
 * unhealthy is this function's. That split is why the port hands over probes rather than a
 * PrismaClient — a port that returned the client would let any use case reach every table through the
 * health check.
 */
export function getHealthReport(startedAt: Date, deps: SystemDeps): Promise<HealthReport> {
  const now = Date.now();
  if (!cached || now - cached.at >= REPORT_TTL_MS) {
    cached = { at: now, report: buildHealthReport(startedAt, deps) };
  }
  return cached.report;
}

async function buildHealthReport(startedAt: Date, deps: SystemDeps): Promise<HealthReport> {
  const [appDb, analysisService] = await Promise.all([
    checkDependency(() => deps.systemHealth.checkAppDatabase()),
    checkDependency(() => deps.systemHealth.checkAnalysisService()),
  ]);

  return {
    status: appDb.status === "ok" && analysisService.status === "ok" ? "ok" : "degraded",
    uptimeSeconds: process.uptime(),
    startedAt: startedAt.toISOString(),
    dependencies: { appDb, analysisService },
  };
}
