import express from "ultimate-express";
import { routes } from "./routes.js";
import { errorHandler, notFoundHandler } from "./shared/errorHandler.js";

export function createApp() {
  const app = express();

  // Forwards rejected/throwing async route handlers to next(err) automatically,
  // matching Express 5's built-in behavior (off by default in ultimate-express).
  app.set("catch async errors", true);

  app.use(express.json());

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
