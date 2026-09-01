import { Pool, type QueryResultRow } from "pg";

// Matches `<NAME>_DATABASE_URL` for any <NAME>. The bare `DATABASE_URL` (this service's own,
// Prisma-managed DB — see adapters/neon/prismaClient.ts) has no `<NAME>_` prefix, so it never
// matches and is never swept into this raw pg pool registry.
const DATABASE_URL_PATTERN = /^(.+)_DATABASE_URL$/;

const pools = new Map<string, Pool>();

// Per the microservice DB connection best-practices review (oingg-conductor-ts/docs): cap pool size and
// fail fast on exhaustion instead of relying on pg's defaults (max 10 already matches that default, but
// pg leaves connectionTimeoutMillis/idleTimeoutMillis unset — i.e. unbounded wait to acquire a
// connection, and connections never recycled). connectionTimeoutMillis is set higher than the
// report's general 1-3s guidance specifically because of this project's own observed Neon behavior:
// a compute that's auto-suspended from being idle can take several seconds to wake on the first query
// after a while (see prismaClient.ts's transactionOptions comment for the same issue on the Prisma side)
// — a tighter timeout here would misreport that as pool exhaustion.
const POOL_CONFIG = {
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 60_000,
};

function discoverConnectionStrings(env: NodeJS.ProcessEnv): Map<string, string> {
  const connections = new Map<string, string>();
  for (const [key, value] of Object.entries(env)) {
    const match = DATABASE_URL_PATTERN.exec(key);
    if (match?.[1] && value) {
      connections.set(match[1].toLowerCase(), value);
    }
  }
  return connections;
}

/**
 * Discovers every `<NAME>_DATABASE_URL` environment variable and opens a connection pool for each one.
 * Call once during app startup.
 *
 * Zero configured pools is a valid, expected state as of 2026-09-01 — this used to throw here on the
 * assumption bff-ts would always own at least one raw external DB (twse/tpex/analysis), which stopped
 * being true once the direct-DB anti-pattern fix moved every one of those to analysis-ts's HTTP API
 * instead (see docs/直連DB反模式修復計畫.md). Discovered live: removing the last `<NAME>_DATABASE_URL`
 * crashed the whole server at startup on this exact check. bff-ts's own DATABASE_URL is Prisma-managed
 * and never goes through this registry regardless, so an empty registry just means "no raw pg pool is
 * needed right now" — not a misconfiguration.
 */
export function initNeonPools(env: NodeJS.ProcessEnv = process.env): void {
  const connections = discoverConnectionStrings(env);

  for (const [name, connectionString] of connections) {
    // TLS behavior comes entirely from each URL's own `sslmode` (use verify-full) — pg overwrites
    // any `ssl` option passed here with what it parses from the connection string, so setting one
    // here would be silently ignored whenever a connectionString is also given.
    pools.set(name, new Pool({ connectionString, ...POOL_CONFIG }));
  }
}

export function getNeonPool(name: string): Pool {
  const pool = pools.get(name.toLowerCase());
  if (!pool) {
    const available = [...pools.keys()].join(", ") || "none";
    throw new Error(`No Neon database pool registered for "${name}". Configured pools: ${available}`);
  }
  return pool;
}

export async function queryNeon<Row extends QueryResultRow = QueryResultRow>(
  name: string,
  text: string,
  params?: unknown[],
) {
  const pool = getNeonPool(name);
  return pool.query<Row>(text, params);
}

export function listNeonPoolNames(): string[] {
  return [...pools.keys()];
}

export async function closeNeonPools(): Promise<void> {
  await Promise.all([...pools.values()].map((pool) => pool.end()));
  pools.clear();
}
