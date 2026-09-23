import cors from "cors";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { Router } from "ultimate-express";
import { requireApiDocsAuth } from "@/http/swagger/apiDocsAuth.js";
import { swaggerSpec, swaggerUi } from "@/http/swagger/index.js";
import { authRouter } from "@/http/modules/auth/route.js";
import { billingRouter } from "@/http/modules/billing/route.js";
import { etfScreenerRouter } from "@/http/modules/etfScreener/route.js";
import { metricCatalogRouter } from "@/http/modules/metricCatalog/route.js";
import { createHoldingsRouter } from "@/http/modules/holdings/route.js";
import { industriesRouter } from "@/http/modules/industries/route.js";
import { createMacroRouter } from "@/http/modules/macro/route.js";
import { marketRouter } from "@/http/modules/market/route.js";
import { screenerRoutes } from "@/http/modules/screener/index.js";
import { securitiesRouter } from "@/http/modules/securities/route.js";
import { stockRouter } from "@/http/modules/stock/route.js";
import { systemRouter } from "@/http/modules/system/route.js";
import { startedAt } from "@/application/system/system.state.js";
import { createTransactionsRouter } from "@/http/modules/transactions/route.js";
import { userRouter } from "@/http/modules/user/route.js";
import { createWatchlistRouter } from "@/http/modules/watchlist/route.js";
import { env, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from "@/shared/env.js";
import type { AppDeps } from "@/application/deps.js";

// Single place to see every mounted path — check here before grepping through src/http/modules.
export function createRoutes(deps: AppDeps): Router {
  const routes = Router();

  // Mounted on this inner Router rather than the outer app: ultimate-express drops headers set by
  // app-level middleware once the request descends into this Router, so helmet/cors must live here
  // to actually appear on responses (verified via curl, not just code inspection — see security report).
  routes.use(helmet());
  routes.use(cors({ origin: env.corsOrigins }));
  routes.use(
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: { message: "Too many requests" } });
      },
    }),
  );

  routes.get("/", (_req, res) => {
    res.json({
      status: "ok",
      startedAt: startedAt.toISOString(),
      uptimeSeconds: process.uptime(),
    });
  });

  routes.use("/api-docs", requireApiDocsAuth, swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  routes.use("/system", systemRouter); // GET /system/health
  routes.use("/auth", authRouter); // GET /auth/me
  routes.use("/billing", billingRouter); // GET /billing/entitlement
  // GET /users/me; GET /users/me/theme; PUT /users/me/theme/mode, /theme/accent-color,
  // /theme/market-color-convention, /theme/full-width;
  // GET /users/me/screener-display-settings; PUT /users/me/screener-display-settings/show-as-of-date
  routes.use("/users", userRouter);
  routes.use("/stocks", stockRouter); // GET /stocks/:symbol
  routes.use("/watchlist", createWatchlistRouter(deps)); // GET/POST /watchlist, GET/PATCH/DELETE /watchlist/:id
  routes.use("/holdings", createHoldingsRouter(deps)); // GET/POST /holdings, GET/PATCH/DELETE /holdings/:id
  routes.use("/transactions", createTransactionsRouter(deps)); // GET/POST /transactions, GET/PATCH/DELETE /transactions/:id
  // POST /screener; POST /screener/values; GET/POST /screener/column-presets, GET/PATCH/DELETE /screener/column-presets/:id;
  // GET /screener/column-preset-templates, GET /screener/column-preset-templates/:key,
  // POST /screener/column-preset-templates/:key/apply;
  // GET/POST /screener/presets, GET/PATCH/DELETE /screener/presets/:id, GET /screener/presets/:id/run;
  // GET /screener/templates, GET /screener/templates/:id, POST /screener/templates/:id/apply
  routes.use("/screener", screenerRoutes);
  routes.use("/metrics", metricCatalogRouter); // GET /metrics, POST /metrics/sync
  routes.use("/market", marketRouter); // GET /market/margin-short-ratio-ranking, ...
  // GET /macro/cbc-policy-rate, /macro/business-cycle-indicator, /macro/monetary-aggregate,
  // /macro/gov-bond-yield-10y, /macro/gov-bond-yield-10y-history, /macro/stock-market-summary, /macro/usd-twd-rate, /macro/cpi, /macro/gdp
  routes.use("/macro", createMacroRouter(deps));
  routes.use("/etf-screener", etfScreenerRouter); // GET /etf-screener/filters, POST /etf-screener
  routes.use("/industries", industriesRouter); // GET /industries/tree
  routes.use("/securities", securitiesRouter); // GET /securities

  return routes;
}
