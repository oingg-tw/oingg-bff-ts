import cors from "cors";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { Router } from "ultimate-express";
import { AppError } from "@/domain/appError.js";
import { requestIdOf } from "@/http/requestLogger.js";
import { requireApiDocsAuth } from "@/http/swagger/apiDocsAuth.js";
import { swaggerSpec, swaggerUi } from "@/http/swagger/index.js";
import { createAuthRouter } from "@/http/modules/auth/route.js";
import { createBillingRouter } from "@/http/modules/billing/route.js";
import { createEtfScreenerRouter } from "@/http/modules/etfScreener/route.js";
import { createMetricCatalogRouter } from "@/http/modules/metricCatalog/route.js";
import { createHoldingsRouter } from "@/http/modules/holdings/route.js";
import { createIndustriesRouter } from "@/http/modules/industries/route.js";
import { createMacroRouter } from "@/http/modules/macro/route.js";
import { createMarketRouter } from "@/http/modules/market/route.js";
import { createScreenerRoutes } from "@/http/modules/screener/index.js";
import { createSecuritiesRouter } from "@/http/modules/securities/route.js";
import { createBrokersRouter } from "@/http/modules/brokers/route.js";
import { createStockRouter } from "@/http/modules/stock/route.js";
import { createSystemRouter } from "@/http/modules/system/route.js";
import { startedAt } from "@/application/system/system.state.js";
import { createTransactionsRouter } from "@/http/modules/transactions/route.js";
import { createUserRouter } from "@/http/modules/user/route.js";
import { createWatchlistRouter } from "@/http/modules/watchlist/route.js";
import { env, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from "@/shared/env.js";
import type { AppDeps } from "@/application/deps.js";

/**
 * 限流的分桶鍵。**不設 `trust proxy`，用自訂 keyGenerator 取代**，而且取的是 `X-Forwarded-For` 的
 * **最右邊**那一項。
 *
 * 要解決的問題（2026-10-04 實測部署端）：原本沒有 keyGenerator，所以預設用 `req.ip`，而在 Cloud Run 上
 * 那永遠是 Google 前端的位址——**300 req/60s 因此是全站共用而不是每個客戶端**，任何一個呼叫端都能把所有
 * 使用者的額度用光。實測連續四次換不同的 `X-Forwarded-For`，`ratelimit-remaining` 照樣 299→298→297→296。
 * 本機也一樣（本機沒有 proxy，所以本機的 `req.ip` 反而是對的；這個缺陷只在部署端成立，沒有任何測試抓得到）。
 *
 * **為什麼不用 `trust proxy: true`**：express-rate-limit 明確把它列為 `ERR_ERL_PERMISSIVE_TRUST_PROXY`——
 * 那會讓 express 取 XFF 的**最左邊**，而最左邊是呼叫端可以自己填的，等於開一個用輪換標頭繞過限流的洞。
 *
 * **為什麼取最右邊而不是數第 N 個**：那不需要先知道 Cloud Run 是覆寫整個 XFF 還是把真實 IP 附加在後面。
 * 覆寫 → 最右邊就是客戶端 IP；附加 → 客戶端自己送的值會排在 Google 附加的那一項**之前**，所以最右邊仍是
 * 真實來源、且不可偽造。只有「真實 IP 在最前面、Google 的內部位址在最後」這種排法會讓它退化成常數，
 * 而那等於現況、**不會比現在更糟**。
 *
 * `ipKeyGenerator` 的包裹是必要的、不是裝飾：直接回傳 IP 字串會讓 IPv6 客戶端在自己的 /64 內換位址就
 * 繞過限流（express-rate-limit 的 `ERR_ERL_KEY_GEN_IPV6`）。
 *
 * 副作用要知道：**供了自訂 keyGenerator 之後，那兩個 ValidationError 警告就不再出現**——警告消失是因為
 * 檢查被略過，不是因為設定一定正確。驗證要看分桶行為，不要看 log 乾淨。
 */
function rateLimitKey(req: { ip?: string; headers: Record<string, unknown> }): string {
  const forwarded = req.headers["x-forwarded-for"];
  const chain = Array.isArray(forwarded) ? forwarded.join(",") : typeof forwarded === "string" ? forwarded : "";
  const rightmost = chain.split(",").at(-1)?.trim();
  return ipKeyGenerator(rightmost || req.ip || "unknown");
}

// Single place to see every mounted path — check here before grepping through src/http/modules.
export function createRoutes(deps: AppDeps): Router {
  const routes = Router();

  // Mounted on this inner Router rather than the outer app: ultimate-express drops headers set by
  // app-level middleware once the request descends into this Router, so helmet/cors must live here
  // to actually appear on responses (verified via curl, not just code inspection — see security report).
  routes.use(helmet());
  // 瀏覽器預設讀不到這兩個 header：X-Request-Id 讓錯誤對話框能顯示參考編號，Retry-After 讓它倒數。
  routes.use(cors({ origin: env.corsOrigins, exposedHeaders: ["X-Request-Id", "Retry-After"] }));
  // 設在內層 Router：外層 app 的 middleware 設的 header 會被 ultimate-express 丟掉（上面那段說明）。
  routes.use((_req, res, next) => {
    res.set("X-Request-Id", requestIdOf(res));
    next();
  });
  routes.use(
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: rateLimitKey,
      // Retry-After 已由套件在呼叫 handler 之前設好（standardHeaders）；這裡只負責讓本體走 RFC 9457。
      handler: (_req, _res, next) => {
        next(new AppError("Too many requests", 429, undefined, "RATE_LIMITED"));
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

  routes.use("/system", createSystemRouter(deps)); // GET /system/health
  routes.use("/auth", createAuthRouter(deps)); // GET /auth/me
  routes.use("/billing", createBillingRouter(deps)); // GET /billing/entitlement
  // GET /users/me; GET /users/me/theme; PUT /users/me/theme/mode, /theme/accent-color,
  // /theme/market-color-convention, /theme/full-width;
  // GET /users/me/screener-display-settings; PUT /users/me/screener-display-settings/show-as-of-date;
  // GET/PUT /users/me/dashboard-cards, /me/stock-detail-preferences, /me/preferred-stocks-preferences, /me/holding-columns
  routes.use("/users", createUserRouter(deps));
  routes.use("/stocks", createStockRouter(deps)); // GET /stocks/:symbol
  routes.use("/watchlist", createWatchlistRouter(deps)); // GET/POST /watchlist, GET/PATCH/DELETE /watchlist/:id
  routes.use("/holdings", createHoldingsRouter(deps)); // GET /holdings, DELETE /holdings/:symbol（唯讀投影，見該切片）
  routes.use("/transactions", createTransactionsRouter(deps)); // GET/POST /transactions, GET/PATCH/DELETE /transactions/:id
  // POST /screener; POST /screener/values; GET/POST /screener/column-presets, GET/PATCH/DELETE /screener/column-presets/:id;
  // GET /screener/column-preset-templates, GET /screener/column-preset-templates/:key,
  // POST /screener/column-preset-templates/:key/apply;
  // GET/POST /screener/presets, GET/PATCH/DELETE /screener/presets/:id, GET /screener/presets/:id/run;
  // GET /screener/templates, GET /screener/templates/:id, POST /screener/templates/:id/apply
  routes.use("/screener", createScreenerRoutes(deps));
  routes.use("/metrics", createMetricCatalogRouter(deps)); // GET /metrics, POST /metrics/sync
  routes.use("/market", createMarketRouter(deps)); // GET /market/margin-short-ratio-ranking, ...
  // GET /macro/cbc-policy-rate, /macro/business-cycle-indicator, /macro/monetary-aggregate,
  // /macro/gov-bond-yield-10y, /macro/gov-bond-yield-10y-history, /macro/stock-market-summary, /macro/usd-twd-rate, /macro/cpi, /macro/gdp
  routes.use("/macro", createMacroRouter(deps));
  routes.use("/etf-screener", createEtfScreenerRouter(deps)); // GET /etf-screener/filters, POST /etf-screener
  // GET /industries/securities-sectors, /industries/sector-dividend-summary
  // （/tree 與 /flat 的財政部稅籍五層分類 2026-10-02 隨上游退役移除）
  routes.use("/industries", createIndustriesRouter(deps));
  routes.use("/securities", createSecuritiesRouter(deps)); // GET /securities
  routes.use("/brokers", createBrokersRouter(deps)); // GET /brokers

  return routes;
}
