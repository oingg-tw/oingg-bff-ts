import { createApp } from "./app.js";
import { initFirebase } from "./adapters/firebase/index.js";
import { closeNeonPools, closePrismaClient, initNeonPools } from "./adapters/neon/index.js";
import { startColumnPresetTemplateSync } from "./domains/columnPresetTemplates/index.js";
import { startFilterCatalogSync } from "./domains/filterCatalog/index.js";
import { env } from "./shared/env.js";

async function main(): Promise<void> {
  initFirebase();
  initNeonPools();

  // oingg-analysis-ts (數據中台) must never know oingg-bff-ts exists, so there is no push/notify
  // mechanism from their side — bff-ts is the only one who can keep these fresh, by pulling on its own.
  // Fire-and-forget from an external service that may still be booting or briefly down — never blocks
  // startup or crashes the server; each retries on its own (see filterCatalog.service.ts /
  // columnPresetTemplates.service.ts). Company names (src/domains/companies) are deliberately NOT synced
  // here — that's analysis-ts's market data, fetched live per request, never cached as our own copy.
  startFilterCatalogSync();
  startColumnPresetTemplateSync();

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
