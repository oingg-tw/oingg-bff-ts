import { Pool, type QueryResultRow } from "pg";

const NEON_DB_URL_PATTERN = /^NEON_DB_(.+)_URL$/;

const pools = new Map<string, Pool>();

function discoverConnectionStrings(env: NodeJS.ProcessEnv): Map<string, string> {
  const connections = new Map<string, string>();
  for (const [key, value] of Object.entries(env)) {
    const match = NEON_DB_URL_PATTERN.exec(key);
    if (match?.[1] && value) {
      connections.set(match[1].toLowerCase(), value);
    }
  }
  return connections;
}

/**
 * Discovers every `NEON_DB_<NAME>_URL` environment variable and opens a
 * connection pool for each one. Call once during app startup.
 */
export function initNeonPools(env: NodeJS.ProcessEnv = process.env): void {
  const connections = discoverConnectionStrings(env);
  if (connections.size === 0) {
    throw new Error(
      "No Neon database connections configured. Set at least one NEON_DB_<NAME>_URL environment variable.",
    );
  }

  for (const [name, connectionString] of connections) {
    pools.set(
      name,
      new Pool({
        connectionString,
        ssl: { rejectUnauthorized: true },
      }),
    );
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
