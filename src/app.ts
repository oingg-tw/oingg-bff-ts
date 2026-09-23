import express from "ultimate-express";
import { createRoutes } from "@/routes.js";
import type { AppDeps } from "@/application/deps.js";
import { errorHandler, jsonBodyErrorHandler, notFoundHandler } from "@/http/errorHandler.js";
import { requestLogger } from "@/http/requestLogger.js";

export function createApp(deps: AppDeps) {
  const app = express();

  // Forwards rejected/throwing async route handlers to next(err) automatically,
  // matching Express 5's built-in behavior (off by default in ultimate-express).
  app.set("catch async errors", true);

  // One structured log line per completed request — bff-ts is this system's request gateway, so this is
  // the log line that answers "which request hit which failure" across the other logger.error call sites
  // this same change migrated to. Hand-rolled rather than pino-http — see requestLogger.ts for why.
  app.use(requestLogger);

  app.use(express.json());
  // Must sit here, directly behind the parser — see jsonBodyErrorHandler for why it can't live in errorHandler.
  app.use(jsonBodyErrorHandler);

  app.use(createRoutes(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
