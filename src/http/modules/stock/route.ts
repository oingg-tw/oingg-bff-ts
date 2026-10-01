import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { parseBody } from "@/shared/validation.js";
import type { StockProxyDeps } from "@/application/proxy/stock/stock.service.js";

const MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST = 100;

/** A "limit" query param bounded to [min, max] — each history endpoint below matches analysis-ts's own bound for that specific endpoint (they're not all the same). */
function limitSchema(min: number, max: number) {
  return z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z
      .coerce.number({ error: `"limit" must be an integer between ${min} and ${max}` })
      .refine((n) => Number.isInteger(n) && n >= min && n <= max, {
        message: `"limit" must be an integer between ${min} and ${max}`,
      })
      .optional(),
  );
}

/** Shared by metric-history/roe-history/roa-history/dupont-history — matches analysis-ts's own 1-40 bound. */
const historyLimitSchema = limitSchema(1, 40);

/** Matches analysis-ts's own GET /companies bound (confirmed live, 2026-09-11). */

export const companyListQuerySchema = z.object({
  limit: limitSchema(1, 1000),
  offset: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z
      .coerce.number({ error: '"offset" must be a non-negative integer' })
      .refine((n) => Number.isInteger(n) && n >= 0, { message: '"offset" must be a non-negative integer' })
      .optional(),
  ),
});

const YYYY_MM_PATTERN = /^\d{4}-\d{2}$/;

export const exDividendCalendarQuerySchema = z.object({
  month: z
    .string({ error: '"month" is required' })
    .regex(YYYY_MM_PATTERN, { error: '"month" must be in "YYYY-MM" format, e.g. "2026-09"' }),
});

export const preferredStocksQuerySchema = z.object({
  symbol: z.string().trim().min(1, '"symbol" must be a non-empty string').optional(),
});

/**
 * analysis-ts 的 year/season：**輸入是民國年、回應是西元年**（`year=114` 回 `fiscalYear: 2025`），
 * 三支端點（financial-statement、piotroski-breakdown、metric-provenance）全是同一個規則，2026-09-30
 * 逐支實測確認。這裡擋的是四位數的西元年——上游會回 400，而我們的 assertAnalysisServiceOk 會把它轉成
 * 一句沒有資訊的 502「returned 400」，web-nuxt 的 fallback 再把 502 顯示成「資料不足」，於是一個純粹的
 * 參數錯誤會長得像資料覆蓋率問題。在邊界上擋掉才講得出哪裡錯。
 *
 * 只擋位數不列舉合法值：民國年在這份程式碼的餘命內不會變成四位數，而列舉會重演 metricProvenance
 * 那次「硬編 enum 擋掉上游新增值」的坑。season 的 1-4 是照抄上游的 enum。
 */
const rocYearSeason = {
  year: z
    .string()
    .trim()
    .regex(/^\d{2,3}$/, { error: '"year" must be a ROC year, e.g. "115" for 2026 (not a Western year)' })
    .optional(),
  season: z.enum(["1", "2", "3", "4"], { error: '"season" must be "1", "2", "3", or "4"' }).optional(),
};

/** year 與 season 必須同時給或同時不給——只給一個上游會拿到半組參數並回一個難解的 400。 */
const bothOrNeither = (data: { year?: string; season?: string }) => (data.year === undefined) === (data.season === undefined);
const bothOrNeitherIssue = { message: '"year" and "season" must be given together, or not at all', path: ["year"] };

export const financialStatementQuerySchema = z
  .object({
    statementType: z.enum(["balanceSheet", "incomeStatement", "cashFlowStatement"], {
      error: '"statementType" must be "balanceSheet", "incomeStatement", or "cashFlowStatement"',
    }),
    ...rocYearSeason,
  })
  .refine(bothOrNeither, bothOrNeitherIssue);

export const metricHistoryQuerySchema = z.object({
  metricCode: z.enum(["eps", "peRatio", "pbRatio", "bvps", "stockPrice"], {
    error: '"metricCode" must be "eps", "peRatio", "pbRatio", "bvps", or "stockPrice"',
  }),
  basis: z.enum(["TTM", "Q"], { error: '"basis" must be "TTM" or "Q"' }),
  limit: historyLimitSchema,
});

// `basis` isn't a fixed enum here (unlike metricHistoryQuerySchema) — analysis-ts's own valid values for
// this token differ per metricCode combination (e.g. growth-decomposition codes only allow "Q", not
// "TTM") and are re-validated against GET /metrics' per-metricCode validTokens; a local enum here would
// either be too narrow (rejecting valid combinations) or too permissive to be useful.

export const metricsHistoryQuerySchema = z.object({
  metricCodes: z
    .string({ error: '"metricCodes" must be a comma-separated list of metric codes' })
    .trim()
    .min(1, '"metricCodes" must be a non-empty comma-separated list')
    .transform((value) =>
      value
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean),
    )
    .refine((codes) => codes.length > 0, { error: '"metricCodes" must be a non-empty comma-separated list' }),
  basis: z.string({ error: '"basis" must be a non-empty string' }).trim().min(1, '"basis" must be a non-empty string'),
  limit: historyLimitSchema,
});

/**
 * `basis` 不設 enum，由上游驗證——同 metricsHistoryQuerySchema，而這支是被實證推到這個結論的。
 *
 * 這份白名單在 2026-10-01 一天內被證明錯了兩次，而且**第二次證明單一 enum 不可能正確**：
 *
 * ```
 * 原本 ["Q","Q_ANN","TTM"]   Q_ANN 上游 2026-09-14（054ae0b4）整批移除「單季年化」時刪掉了，沒有逐支通知
 * 改成 ["Q","TTM"]           同日上游給 roe 補上 FY（a20a5c94），這份又變成太窄
 * ```
 *
 * **這個 schema 是 roe-history 與 roa-history 共用的，而兩支的合法集合已經不同了**：roe 收 Q|TTM|FY，
 * roa 只收 Q|TTM（roa 還沒有 FY）。所以任何一份共用白名單必然在其中一支上是錯的——要嘛擋掉 roe 的 FY，
 * 要嘛放行 roa 不支援的值。拆成兩份可以解決今天，但 roa 拿到 FY 的那天又要再改一次。
 *
 * 交給上游之後：呼叫端拿到的是上游逐欄位的原訊息（2026-09-30 起 4xx 原樣中繼，見 assertAnalysisServiceOk），
 * 期別增減都不用改這裡。代價是打錯字要多一趟往返，那比「宣告一個上游不收的值」便宜——後者會讓呼叫端
 * 以為某個口徑存在。
 */
export const roeRoaHistoryQuerySchema = z.object({
  basis: z.string({ error: '"basis" is required' }).trim().min(1, '"basis" is required'),
  limit: historyLimitSchema,
});

export const dupontHistoryQuerySchema = z.object({
  basis: z.enum(["Q", "TTM"], { error: '"basis" must be "Q" or "TTM"' }),
  limit: historyLimitSchema,
});

// analysis-ts's own bound for this endpoint is 1-120, NOT the same 1-40 as the other history endpoints
// above — confirmed live, 2026-09-07.

export const monthlyRevenueHistoryQuerySchema = z.object({
  limit: limitSchema(1, 120),
});

// analysis-ts's own bound for this endpoint is 1-1500 (confirmed live, 2026-09-08) — much wider than
// the other history endpoints since this is daily (not quarterly/monthly) data.

export const foreignShareholdingHistoryQuerySchema = z.object({
  limit: limitSchema(1, 1500),
});

// analysis-ts's own bound for this endpoint is 1-2000 (confirmed live, 2026-09-10).

export const dailyPriceHistoryQuerySchema = z.object({
  limit: limitSchema(1, 2000),
});

export const piotroskiBreakdownQuerySchema = z
  .object({
    ...rocYearSeason,
  })
  .refine(bothOrNeither, bothOrNeitherIssue);

// Not a fixed enum — analysis-ts's own supported metricCode set for this endpoint keeps growing (started
// at 3, now 112+, see GET /metrics' hasProvenance field) and validates itself; a bad value here is relayed
// as analysis-ts's own 400 message (see metricProvenance.client.ts) rather than guessed at locally. A
// hardcoded enum here used to silently block newly-added metricCodes until this file caught up — see
// metricProvenance.types.ts's MetricProvenanceMetricCode.

export const metricProvenanceQuerySchema = z
  .object({
    metricCode: z.string({ error: '"metricCode" is required' }).trim().min(1, '"metricCode" is required'),
    ...rocYearSeason,
  })
  .refine(bothOrNeither, bothOrNeitherIssue);

/**
 * 這個切片沒有留 service：原本的 stock.service.ts 除了 assertSymbolExists 以外，每個函式都是
 * `getX(args) => fetchX(args)`，真正的規則（limit 上下界、metricCode/basis 列舉、year/season 必須成對）
 * 一直都在上面這些 zod schema 裡，而那份 schema 同時是 OpenAPI 的來源（見 openapi.ts）。所以 route
 * 直接呼叫 gateway port，跟 macro 切片同樣的判斷。
 *
 * 改成工廠函式純粹是為了把 port 傳進來：註冊順序、驗證規則、界限與錯誤訊息一個字都沒動——"/preferred-stocks"
 * 之類的固定路徑仍然必須排在 "/:symbol" 前面，否則會被當成股票代號吃掉。
 */
export function createStockRouter(deps: StockProxyDeps): Router {
  const stockRouter = Router();

  // Bare "/stocks" — the full-market company directory backing site-wide search. Distinct from every
  // "/stocks/<segment>" route below regardless of registration order, since it has no path segment beyond
  // the mount point.
  stockRouter.get("/", async (req, res) => {
    const query = parseBody(companyListQuerySchema, req.query);
    const result = await deps.stockGateway.getCompanyList(query.limit, query.offset);
    res.json(result);
  });

  stockRouter.get("/ex-dividend-notices", async (req, res) => {
    const symbolsParam = req.query.symbols;
    if (typeof symbolsParam !== "string" || symbolsParam.trim() === "") {
      throw new AppError('Query parameter "symbols" is required (comma-separated stock symbols)', 400);
    }
    const symbols = symbolsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (symbols.length > MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST) {
      throw new AppError(
        `Requested ${symbols.length} symbols at once, but this endpoint caps at ${MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST}`,
        400,
      );
    }
    const notices = await deps.stockGateway.getExDividendNotices(symbols);
    res.json({ notices: Object.fromEntries(notices) });
  });

  // Mounted before the "/:symbol" catch-all below, or "ex-dividend-calendar" would be captured as a symbol.
  stockRouter.get("/ex-dividend-calendar", async (req, res) => {
    const query = parseBody(exDividendCalendarQuerySchema, req.query);
    const result = await deps.stockGateway.getExDividendCalendar(query.month);
    res.json(result);
  });

  // Mounted before the "/:symbol" catch-all below, or "preferred-stocks" would be captured as a symbol.
  stockRouter.get("/preferred-stocks", async (req, res) => {
    const query = parseBody(preferredStocksQuerySchema, req.query);
    const result = await deps.stockGateway.getPreferredStocks(query.symbol);
    res.json(result);
  });

  // Static, param-free — analysis-ts confirmed no DB query, same response every time (2026-09-08).
  stockRouter.get("/preferred-stocks/field-catalog", async (_req, res) => {
    const result = await deps.stockGateway.getPreferredStockFieldCatalog();
    res.json(result);
  });

  stockRouter.get("/:symbol", async (req, res) => {
    const { symbol } = req.params;
    const quote = await deps.stockGateway.getStockQuote(symbol);
    if (!quote) {
      throw new AppError(`No stock data found for symbol "${symbol}"`, 404);
    }
    res.json(quote);
  });

  stockRouter.get("/:symbol/profile", async (req, res) => {
    const { symbol } = req.params;
    const profile = await deps.stockGateway.getCompanyProfile(symbol);
    if (!profile) {
      throw new AppError(`No company profile found for symbol "${symbol}"`, 404);
    }
    res.json(profile);
  });

  stockRouter.get("/:symbol/beta", async (req, res) => {
    const { symbol } = req.params;
    const beta = await deps.stockGateway.getBeta(symbol);
    res.json(beta);
  });

  stockRouter.get("/:symbol/badges", async (req, res) => {
    const { symbol } = req.params;
    const badges = await deps.stockGateway.getCompanyBadges(symbol);
    res.json(badges);
  });

  stockRouter.get("/:symbol/capital-stock-history", async (req, res) => {
    const { symbol } = req.params;
    const history = await deps.stockGateway.getCapitalStockHistory(symbol);
    res.json(history);
  });

  stockRouter.get("/:symbol/dividend-history", async (req, res) => {
    const { symbol } = req.params;
    const history = await deps.stockGateway.getDividendHistory(symbol);
    res.json(history);
  });

  stockRouter.get("/:symbol/financial-statement", async (req, res) => {
    const { symbol } = req.params;
    const query = parseBody(financialStatementQuerySchema, req.query);
    const statement = await deps.stockGateway.getFinancialStatement(symbol, query.statementType, query.year, query.season);
    res.json(statement);
  });

  stockRouter.get("/:symbol/metric-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseBody(metricHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getMetricHistory(symbol, query.metricCode, query.basis, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/metrics-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseBody(metricsHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getMetricsHistory(symbol, query.metricCodes, query.basis, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/roe-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseBody(roeRoaHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getRoeHistory(symbol, query.basis, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/roa-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseBody(roeRoaHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getRoaHistory(symbol, query.basis, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/dupont-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseBody(dupontHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getDupontHistory(symbol, query.basis, query.limit);
    res.json(history);
  });

  // 沒有 query 參數，所以沒有 zod schema 也沒有 service 層 —— 依 CLAUDE.md，純轉發不留空殼。
  stockRouter.get("/:symbol/book-value-breakdown", async (req, res) => {
    const { symbol } = req.params;
    const breakdown = await deps.stockGateway.getBookValueBreakdown(symbol);
    res.json(breakdown);
  });

  stockRouter.get("/:symbol/monthly-revenue-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseBody(monthlyRevenueHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getMonthlyRevenueHistory(symbol, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/foreign-shareholding-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseBody(foreignShareholdingHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getForeignShareholdingHistory(symbol, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/daily-price-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseBody(dailyPriceHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getDailyPriceHistory(symbol, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/piotroski-breakdown", async (req, res) => {
    const { symbol } = req.params;
    const query = parseBody(piotroskiBreakdownQuerySchema, req.query);
    const breakdown = await deps.stockGateway.getPiotroskiBreakdown(symbol, query.year, query.season);
    res.json(breakdown);
  });

  stockRouter.get("/:symbol/metric-provenance", async (req, res) => {
    const { symbol } = req.params;
    const query = parseBody(metricProvenanceQuerySchema, req.query);
    const provenance = await deps.stockGateway.getMetricProvenance(symbol, query.metricCode, query.year, query.season);
    res.json(provenance);
  });

  return stockRouter;
}
