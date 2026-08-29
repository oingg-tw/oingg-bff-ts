import { Pool, type QueryResultRow } from "pg";

// Matches `<NAME>_DATABASE_URL` for any <NAME>. APP is excluded: APP_DATABASE_URL is
// Prisma-managed (see adapters/neon/prismaClient.ts) and isn't part of this raw pg pool registry.
const DATABASE_URL_PATTERN = /^(?!APP_)(.+)_DATABASE_URL$/;

const pools = new Map<string, Pool>();

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
 * Discovers every `<NAME>_DATABASE_URL` environment variable (except `APP_DATABASE_URL`)
 * and opens a connection pool for each one. Call once during app startup.
 */
export function initNeonPools(env: NodeJS.ProcessEnv = process.env): void {
  const connections = discoverConnectionStrings(env);
  if (connections.size === 0) {
    throw new Error(
      "No Neon database connections configured. Set at least one <NAME>_DATABASE_URL environment variable.",
    );
  }

  for (const [name, connectionString] of connections) {
    // TLS behavior comes entirely from each URL's own `sslmode` (use verify-full) — pg overwrites
    // any `ssl` option passed here with what it parses from the connection string, so setting one
    // here would be silently ignored whenever a connectionString is also given.
    pools.set(name, new Pool({ connectionString }));
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
