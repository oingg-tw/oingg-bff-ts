import { createApp } from "./app.js";
import { initFirebase } from "./adapters/firebase/index.js";
import { closeNeonPools, initNeonPools } from "./adapters/neon/index.js";
import { startFilterCatalogSync } from "./domains/filterCatalog/index.js";
import { ensureWatchlistSchema } from "./domains/watchlist/index.js";
import { env } from "./shared/env.js";

async function main(): Promise<void> {
  initFirebase();
  initNeonPools();

  // Schema for our own DB. Best-effort: log and keep going rather than take the whole server down —
  // every other domain (stocks, auth, filters) works fine even if only watchlist ends up broken.
  try {
    await ensureWatchlistSchema();
  } catch (error) {
    console.error("Failed to ensure watchlist schema (watchlist endpoints may fail until this succeeds):", error);
  }

  // Fire-and-forget sync from an external microservice that may still be booting or briefly down —
  // never blocks startup or crashes the server; it retries on its own (see filterCatalog.service.ts).
  startFilterCatalogSync();

  const app = createApp();

  const server = app.listen(env.port, () => {
    console.log(`oingg-bff-ts listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down...`);
    server.close();
    await closeNeonPools();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("Fatal error during startup:", error);
  process.exit(1);
});
