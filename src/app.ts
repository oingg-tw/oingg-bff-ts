import express from "ultimate-express";
import { authRouter } from "./domains/auth/index.js";
import { stockRouter } from "./domains/stock/index.js";
import { startedAt, systemRouter } from "./domains/system/index.js";
import { userRouter } from "./domains/user/index.js";
import { watchlistRouter } from "./domains/watchlist/index.js";
import { errorHandler, notFoundHandler } from "./shared/errorHandler.js";

export function createApp() {
  const app = express();

  // Forwards rejected/throwing async route handlers to next(err) automatically,
  // matching Express 5's built-in behavior (off by default in ultimate-express).
  app.set("catch async errors", true);

  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      status: "ok",
      startedAt: startedAt.toISOString(),
      uptimeSeconds: process.uptime(),
    });
  });

  app.use("/system", systemRouter);
  app.use("/auth", authRouter);
  app.use("/users", userRouter);
  app.use("/stocks", stockRouter);
  app.use("/watchlist", watchlistRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
