import cors from "cors";
import helmet from "helmet";
import { Router } from "ultimate-express";
import { swaggerSpec, swaggerUi } from "@/adapters/swagger/index.js";
import { authRouter } from "@/domains/auth/index.js";
import { etfScreenerRouter } from "@/domains/etfScreener/index.js";
import { filterCatalogRouter } from "@/domains/filterCatalog/index.js";
import { holdingsRouter } from "@/domains/holdings/index.js";
import { marketRouter } from "@/domains/market/index.js";
import { screenerRoutes } from "@/domains/screener/index.js";
import { stockRouter } from "@/domains/stock/index.js";
import { startedAt, systemRouter } from "@/domains/system/index.js";
import { transactionsRouter } from "@/domains/transactions/index.js";
import { userRouter } from "@/domains/user/index.js";
import { watchlistRouter } from "@/domains/watchlist/index.js";
import { env } from "@/shared/env.js";

// Single place to see every mounted path — check here before grepping through src/domains.
export const routes = Router();

// Mounted on this inner Router rather than the outer app: ultimate-express drops headers set by
// app-level middleware once the request descends into this Router, so helmet/cors must live here
// to actually appear on responses (verified via curl, not just code inspection — see security report).
routes.use(helmet());
routes.use(cors({ origin: env.corsOrigins }));

/**
 * @swagger
 * /:
 *   get:
 *     summary: 伺服器啟動時間與運作時長
 *     tags:
 *       - System
 *     responses:
 *       200:
 *         description: 開機時間與 uptime。
 */
routes.get("/", (_req, res) => {
  res.json({
    status: "ok",
    startedAt: startedAt.toISOString(),
    uptimeSeconds: process.uptime(),
  });
});

routes.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

routes.use("/system", systemRouter); // GET /system/health
routes.use("/auth", authRouter); // GET /auth/me
// GET /users/me; GET /users/me/theme; PUT /users/me/theme/mode, /theme/accent-color,
// /theme/market-color-convention, /theme/full-width;
// GET /users/me/screener-display-settings; PUT /users/me/screener-display-settings/show-as-of-date
routes.use("/users", userRouter);
routes.use("/stocks", stockRouter); // GET /stocks/:symbol
routes.use("/watchlist", watchlistRouter); // GET/POST /watchlist, GET/PATCH/DELETE /watchlist/:id
routes.use("/holdings", holdingsRouter); // GET/POST /holdings, GET/PATCH/DELETE /holdings/:id
routes.use("/transactions", transactionsRouter); // GET/POST /transactions, GET/PATCH/DELETE /transactions/:id
// POST /screener; POST /screener/values; GET/POST /screener/column-presets, GET/PATCH/DELETE /screener/column-presets/:id;
// GET /screener/column-preset-templates, GET /screener/column-preset-templates/:key,
// POST /screener/column-preset-templates/:key/apply;
// GET/POST /screener/presets, GET/PATCH/DELETE /screener/presets/:id, GET /screener/presets/:id/run;
// GET /screener/templates, GET /screener/templates/:id, POST /screener/templates/:id/apply
routes.use("/screener", screenerRoutes);
routes.use("/filters", filterCatalogRouter); // GET /filters
routes.use("/market", marketRouter); // GET /market/foreign-holding-ranking, GET /market/margin-short-ratio-ranking
routes.use("/etf-screener", etfScreenerRouter); // GET /etf-screener/filters, POST /etf-screener
