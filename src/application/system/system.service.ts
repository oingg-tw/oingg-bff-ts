import type { AppDeps } from "@/application/deps.js";

const CHECK_TIMEOUT_MS = 3_000;

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
    neon: Record<string, DependencyStatus>;
    appDb: DependencyStatus;
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
 * Actually exercises every dependency this service needs to function — a real minimal query per Neon
 * pool plus the Prisma-managed app DB — rather than just reporting "the process is alive" or "a pool was
 * registered at startup" (registering a pool doesn't mean it's still reachable). `status: "degraded"`
 * means at least one dependency failed; callers (frontend, conductor) can also check per-dependency
 * detail to see exactly which one.
 *
 * What the probes are made of is the port's business (`SELECT 1`, pg vs Prisma); what counts as
 * unhealthy is this function's. That split is why the port hands over probes rather than a
 * PrismaClient — a port that returned the client would let any use case reach every table through the
 * health check.
 */
export async function getHealthReport(startedAt: Date, deps: SystemDeps): Promise<HealthReport> {
  const poolNames = deps.systemHealth.listPoolNames();

  const [neonResults, appDb] = await Promise.all([
    Promise.all(
      poolNames.map(
        async (name) => [name, await checkDependency(() => deps.systemHealth.checkPool(name))] as const,
      ),
    ),
    checkDependency(() => deps.systemHealth.checkAppDatabase()),
  ]);

  const neon = Object.fromEntries(neonResults);
  const allOk = appDb.status === "ok" && neonResults.every(([, result]) => result.status === "ok");

  return {
    status: allOk ? "ok" : "degraded",
    uptimeSeconds: process.uptime(),
    startedAt: startedAt.toISOString(),
    dependencies: { neon, appDb },
  };
}
