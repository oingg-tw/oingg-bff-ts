import express from "ultimate-express";
import { routes } from "@/routes.js";
import { errorHandler, notFoundHandler } from "@/shared/errorHandler.js";
import { requestLogger } from "@/shared/requestLogger.js";

export function createApp() {
  const app = express();

  // Forwards rejected/throwing async route handlers to next(err) automatically,
  // matching Express 5's built-in behavior (off by default in ultimate-express).
  app.set("catch async errors", true);

  // One structured log line per completed request — bff-ts is this system's request gateway, so this is
  // the log line that answers "which request hit which failure" across the other logger.error call sites
  // this same change migrated to. Hand-rolled rather than pino-http — see requestLogger.ts for why.
  app.use(requestLogger);

  app.use(express.json());

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
