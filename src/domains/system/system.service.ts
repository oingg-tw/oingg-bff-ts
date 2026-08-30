import { getPrismaClient, listNeonPoolNames, queryNeon } from "../../adapters/neon/index.js";

const CHECK_TIMEOUT_MS = 3_000;

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
 * Actually exercises every dependency this service needs to function — a real `SELECT 1` per Neon pool
 * plus the Prisma-managed app DB — rather than just reporting "the process is alive" or "a pool was
 * registered at startup" (registering a pool doesn't mean it's still reachable). `status: "degraded"`
 * means at least one dependency failed; callers (frontend, conductor) can also check per-dependency
 * detail to see exactly which one.
 */
export async function getHealthReport(startedAt: Date): Promise<HealthReport> {
  const poolNames = listNeonPoolNames();

  const [neonResults, appDb] = await Promise.all([
    Promise.all(
      poolNames.map(async (name) => [name, await checkDependency(() => queryNeon(name, "select 1"))] as const),
    ),
    checkDependency(() => getPrismaClient().$queryRaw`SELECT 1`),
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
