import { createApp } from "./app.js";
import { initFirebase } from "./adapters/firebase/index.js";
import { closeNeonPools, initNeonPools } from "./adapters/neon/index.js";
import { syncFilterCatalog } from "./domains/filterCatalog/index.js";
import { ensureWatchlistSchema } from "./domains/watchlist/index.js";
import { env } from "./shared/env.js";

async function main(): Promise<void> {
  initFirebase();
  initNeonPools();

  // Schema for our own DB — cheap, local, must succeed before serving requests.
  await ensureWatchlistSchema();

  // Best-effort sync from an external service — don't block startup or crash if it's down.
  syncFilterCatalog().catch((error: unknown) => {
    console.error("Failed to sync filter catalog from filters service:", error);
  });

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

main();
