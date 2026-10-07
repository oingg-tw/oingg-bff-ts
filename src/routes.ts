import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { Router } from "ultimate-express";
import { AppError } from "@/domain/appError.js";
import { requestIdOf } from "@/http/requestLogger.js";
import { clientIpOf } from "@/http/clientIdentity.js";
import { requestContext } from "@/shared/requestContext.js";
import { requireApiDocsAuth } from "@/http/swagger/apiDocsAuth.js";
import { swaggerSpec, swaggerUi } from "@/http/swagger/index.js";
import { createBillingRouter } from "@/http/modules/billing/route.js";
import { createEtfScreenerRouter } from "@/http/modules/etfScreener/route.js";
import { createDataVersionRouter, createMetricCatalogRouter } from "@/http/modules/metricCatalog/route.js";
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
import { GLOBAL_RATE_LIMIT_PER_INSTANCE, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from "@/shared/env.js";
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
 *
 * **2026-10-08 起登入的請求改用 Firebase uid 分桶**（使用者決定，Nitro 成為唯一呼叫端之後）：Nitro 是
 * 唯一呼叫端時 XFF 最右邊全是 Nitro 的出口位址，按 IP 分桶等於全站共用；而同一個公司 NAT 後面的多個使用者
 * 按 IP 也會互相吃額度。匿名請求按 IP，IP 來源見 clientIdentity.ts 的 clientIpOf（只信任驗證過的 Nitro）。
 * token 驗不過就退回按 IP 分桶，那個請求稍後會被 requireAuth 以 401 擋下。
 */
function createRateLimitKey(deps: AppDeps) {
  return async (req: { ip?: string; headers: Record<string, unknown> }): Promise<string> => {
    const authorization = req.headers.authorization;
    if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
      try {
        // ponytail: 同一張 token 在這裡驗一次、requireAuth 再驗一次。verifyIdToken 在公鑰快取後是本地簽章檢查
        // （沒開 checkRevoked），代價很小；真的成為瓶頸再把這裡驗出的身分掛到 req 上讓 requireAuth 重用。
        const identity = await deps.tokenVerifier.verifyIdToken(authorization.slice("Bearer ".length));
        return `uid:${identity.uid}`;
      } catch {
        // 落到下面按 IP
      }
    }
    return ipKeyGenerator(clientIpOf(req));
  };
}

// Single place to see every mounted path — check here before grepping through src/http/modules.
export function createRoutes(deps: AppDeps): Router {
  const routes = Router();

  // Mounted on this inner Router rather than the outer app: ultimate-express drops headers set by
  // app-level middleware once the request descends into this Router, so helmet must live here
  // to actually appear on responses (verified via curl, not just code inspection — see security report).
  routes.use(helmet());
  // 沒有 CORS（2026-10-08 拿掉）：Nitro 成為唯一呼叫端、瀏覽器不再直連業務中台（web-nuxt 58340ed 實測 12 頁
  // 零請求）。不送任何 Access-Control-* header，等於瀏覽器的跨站呼叫一律讀不到回應——這正是要的。
  // 要恢復瀏覽器直連，先問使用者：那推翻的是「Nitro 是真正的 BFF」這個架構決定，不是一個設定。
  // 設在內層 Router：外層 app 的 middleware 設的 header 會被 ultimate-express 丟掉（上面那段說明）。
  //
  // Cache-Control 預設 no-store、要快取的路由自己覆寫（目前只有 valuation-river 的 public, max-age=3600）
  // ——2026-10-08 依 conductor 的《Nuxt Nitro 全端架構下的個人資料保護》：快取採白名單、涉及個資的端點
  // no-store。反過來（預設可快取、個資端點自己記得關）的話，新增一支 per-user 端點時忘了關就會讓中間層
  // （Nitro 的快取、瀏覽器）把一個人的資料存起來給另一個人。
  routes.use((_req, res, next) => {
    const requestId = requestIdOf(res);
    res.set("X-Request-Id", requestId);
    res.set("Cache-Control", "no-store");
    requestContext.run({ requestId }, next);
  });
  routes.use(
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: createRateLimitKey(deps),
      // Retry-After 已由套件在呼叫 handler 之前設好（standardHeaders）；這裡只負責讓本體走 RFC 9457。
      handler: (_req, _res, next) => {
        next(new AppError("Too many requests", 429, undefined, "rate_limited"));
      },
    }),
  );
  // 全站總上限（見 env.ts 的 GLOBAL_RATE_LIMIT_PER_INSTANCE）。掛在每人限流**之後**：被每人限流擋下的請求
  // 不會再吃全站額度，一個濫用者不會把全站額度用光。
  //
  // 回 503 不是 429（RFC 9110）：429 是「你送太多了」，503 是「伺服器暫時過載」——超過全站上限不是這位使用者
  // 的錯，前端的讀取失敗對話框也據 code 顯示「伺服器忙碌」而不是「你太快了」。不送 RateLimit-* header，否則會
  // 蓋掉上面每人限流的那組（客戶端看的應該是自己的剩餘額度）；Retry-After 在 handler 裡自己算。
  routes.use(
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: GLOBAL_RATE_LIMIT_PER_INSTANCE,
      standardHeaders: false,
      legacyHeaders: false,
      keyGenerator: () => "global",
      requestPropertyName: "globalRateLimit",
      handler: (req, res, next) => {
        const resetTime = (req as { globalRateLimit?: { resetTime?: Date } }).globalRateLimit?.resetTime;
        const seconds = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : RATE_LIMIT_WINDOW_MS / 1000;
        res.set("Retry-After", String(seconds));
        next(new AppError("The server is busy, try again shortly", 503, undefined, "server_busy"));
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
  routes.use("/billing", createBillingRouter(deps)); // GET /billing/entitlement
  // GET /users/me; GET /users/me/theme; PUT /users/me/theme/mode, /theme/accent-color,
  // /theme/market-color-convention, /theme/full-width;
  // GET /users/me/screener-display-settings; PUT /users/me/screener-display-settings/show-as-of-date;
  // GET/PUT /users/me/preferred-stocks-preferences, /me/holding-columns, /me/watchlist-columns
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
  routes.use("/data-version", createDataVersionRouter(deps)); // GET /data-version（analysis-ts 原樣轉發）
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
