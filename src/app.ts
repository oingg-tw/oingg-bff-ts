import cors from "cors";
import express from "ultimate-express";
import { routes } from "./routes.js";
import { errorHandler, notFoundHandler } from "./shared/errorHandler.js";
import { env } from "./shared/env.js";

export function createApp() {
  const app = express();

  // Forwards rejected/throwing async route handlers to next(err) automatically,
  // matching Express 5's built-in behavior (off by default in ultimate-express).
  app.set("catch async errors", true);

  // Must come before routes so preflight (OPTIONS) requests are answered here, not 401'd by requireAuth.
  app.use(cors({ origin: env.corsOrigins }));

  app.use(express.json());

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
