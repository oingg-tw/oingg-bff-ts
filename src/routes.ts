import { Router } from "ultimate-express";
import { authRouter } from "./domains/auth/index.js";
import { stockRouter } from "./domains/stock/index.js";
import { startedAt, systemRouter } from "./domains/system/index.js";
import { userRouter } from "./domains/user/index.js";
import { watchlistRouter } from "./domains/watchlist/index.js";

// Single place to see every mounted path — check here before grepping through src/domains.
export const routes = Router();

routes.get("/", (_req, res) => {
  res.json({
    status: "ok",
    startedAt: startedAt.toISOString(),
    uptimeSeconds: process.uptime(),
  });
});

routes.use("/system", systemRouter); // GET /system/health
routes.use("/auth", authRouter); // GET /auth/me
routes.use("/users", userRouter); // GET /users/me
routes.use("/stocks", stockRouter); // GET /stocks/:symbol
routes.use("/watchlist", watchlistRouter); // GET/POST /watchlist, GET/PATCH/DELETE /watchlist/:id
