import { createApp } from "@/app.js";
import { createAppDeps } from "@/bootstrap/deps.js";
import { initFirebase } from "@/infrastructure/firebase/index.js";
import { closePrismaClient } from "@/infrastructure/prisma/index.js";
import { startMetricCatalogSync } from "@/application/metricCatalog/metricCatalog.service.js";
import { env } from "@/shared/env.js";
import { logger } from "@/shared/logger.js";

async function main(): Promise<void> {
  initFirebase();

  // Composition root runs right after the driver init above, so every port already has a live
  // connection behind it — both for the startup sync below and for the app itself.
  const deps = createAppDeps();

  // oingg-analysis-ts (數據中台) must never know oingg-bff-ts exists, so there is no push/notify
  // mechanism from their side — bff-ts is the only one who can keep this fresh, by pulling on its own.
  // Fire-and-forget from an external service that may still be booting or briefly down — never blocks
  // startup or crashes the server; retries on its own (see metricCatalog.service.ts). Column preset
  // templates used to sync the same way, but analysis-ts dropped that field entirely 2026-09-08 and
  // never brought it back — that table is now purely bff-ts-curated (see prisma/seedColumnPresetTemplates.ts),
  // same as PresetTemplate, with no sync mechanism at all.
  startMetricCatalogSync(deps);

  const app = createApp(deps);

  const server = app.listen(env.port, () => {
    logger.info(`oingg-bff-ts listening on port ${env.port} (${env.nodeEnv})`);
    logger.info(`API docs available at http://localhost:${env.port}/api-docs`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`);
    server.close();
    await closePrismaClient();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "Fatal error during startup");
  process.exit(1);
});
