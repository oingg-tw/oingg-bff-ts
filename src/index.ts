import { createApp } from "./app.js";
import { initFirebase } from "./adapters/firebase/index.js";
import { closeNeonPools, closePrismaClient, initNeonPools } from "./adapters/neon/index.js";
import { startFilterCatalogSync } from "./domains/filterCatalog/index.js";
import { env } from "./shared/env.js";

async function main(): Promise<void> {
  initFirebase();
  initNeonPools();

  // Fire-and-forget sync from an external microservice that may still be booting or briefly down —
  // never blocks startup or crashes the server; it retries on its own (see filterCatalog.service.ts).
  startFilterCatalogSync();

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
