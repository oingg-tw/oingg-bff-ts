import { createApp } from "./app.js";
import { initFirebase } from "./adapters/firebase/index.js";
import { closeNeonPools, closePrismaClient, initNeonPools } from "./adapters/neon/index.js";
import { bootstrapFilterCatalogIfEmpty } from "./domains/filterCatalog/index.js";
import { env } from "./shared/env.js";

async function main(): Promise<void> {
  initFirebase();
  initNeonPools();

  // No longer an unconditional resync on every restart — oingg-analysis-ts now pushes updates via
  // POST /filters/sync whenever its own catalog changes. This only bootstraps a genuinely empty local
  // catalog (fresh deployment); fire-and-forget, never blocks or fails startup.
  void bootstrapFilterCatalogIfEmpty();

  const app = createApp();

  const server = app.listen(env.port, () => {
    console.log(`oingg-bff-ts listening on port ${env.port} (${env.nodeEnv})`);
    console.log(`API docs available at http://localhost:${env.port}/api-docs`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down...`);
    server.close();
    await Promise.all([closeNeonPools(), closePrismaClient()]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("Fatal error during startup:", error);
  process.exit(1);
});
