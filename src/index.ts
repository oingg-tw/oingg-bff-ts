import { createApp } from "./app.js";
import { initFirebase } from "./adapters/firebase/index.js";
import { closeNeonPools, initNeonPools } from "./adapters/neon/index.js";
import { env } from "./shared/env.js";

function main(): void {
  initFirebase();
  initNeonPools();

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
