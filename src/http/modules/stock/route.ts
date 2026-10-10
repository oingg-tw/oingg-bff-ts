import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { limitSchema, parseQuery, rejectRetiredParams } from "@/shared/validation.js";
import type { StockProxyDeps } from "@/application/proxy/stock/stock.service.js";

const MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST = 100;


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
 * 查某一季：西元 `fiscalYear` ＋ 整數 `fiscalQuarter`（2026-10-10 起，統一用語；analysis-ts 05967082 起上游也只認這組）。
 * 在那之前對外與上游都是民國年字串 `year` ＋ `season`（`year=114` 回 `fiscalYear: 2025`），曾經因為送四位數西元年
 * 被上游 400、再被顯示成「資料不足」——現在參數本身就是西元，那個陷阱沒了。舊的 year／season 並存到 2026-10-11
 * （web-nuxt 確認改完），之後給了會 400 並指出新名（rejectRetiredParams）。
 *
 * 範圍只做基本檢查（四位數的年、1～4 季），合法期間由上游決定。
 */
const fiscalYearQuarter = {
  fiscalYear: limitSchema(1900, 2200, "fiscalYear"),
  fiscalQuarter: limitSchema(1, 4, "fiscalQuarter"),
};

/** fiscalYear 與 fiscalQuarter 必須同時給或同時不給——只給一個上游會回 400。都不給＝最新一季。 */
const bothOrNeither = (data: { fiscalYear?: number; fiscalQuarter?: number }) => (data.fiscalYear === undefined) === (data.fiscalQuarter === undefined);
const bothOrNeitherIssue = { message: '"fiscalYear" and "fiscalQuarter" must be given together, or not at all', path: ["fiscalYear"] };

/** 期別：2026-10-10 起對外叫 timeframe（統一用語；舊名 basis 2026-10-11 起不收，timeframe 必填所以給舊名會 400）。值不列舉，由上游驗（理由見各 schema）。 */
const timeframeParam = z.string({ error: '"timeframe" is required' }).trim().min(1, '"timeframe" is required');

export const financialStatementQuerySchema = z
  .object({
    statementType: z.enum(["balanceSheet", "incomeStatement", "cashFlowStatement"], {
      error: '"statementType" must be "balanceSheet", "incomeStatement", or "cashFlowStatement"',
    }),
    ...fiscalYearQuarter,
  })
  .refine(bothOrNeither, bothOrNeitherIssue);

// `basis` isn't a fixed enum here — analysis-ts's own valid values for
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
  timeframe: timeframeParam,
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
  timeframe: timeframeParam,
  limit: historyLimitSchema,
});

export const dupontHistoryQuerySchema = z.object({
  timeframe: z.enum(["Q", "TTM"], { error: '"timeframe" must be "Q" or "TTM"' }),
  limit: historyLimitSchema,
});

// analysis-ts's own bound for this endpoint is 1-132 (was 1-120 until 2026-10-10), NOT the same 1-40 as the other history endpoints
// above — confirmed live, 2026-09-07.

/**
 * 估值河流圖的查詢（2026-10-08）。ratio 必填、三選一；lookbackYears 選填 1–10，**只有給了才轉發**——
 * 省略時上游用它自己的預設（5 年），回應才會跟這個參數存在之前一樣。
 */
export const valuationRiverQuerySchema = z.object({
  ratio: z.enum(["pe", "pb", "ps"], { error: '"ratio" must be one of pe, pb, ps' }),
  lookbackYears: limitSchema(1, 10, "lookbackYears"),
});

export const monthlyRevenueHistoryQuerySchema = z.object({
  limit: limitSchema(1, 132), // 2026-10-10 跟 analysis-ts 758a2b90 一起從 120 調到 132（回補到 2016-01 約 128 個月）
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
    ...fiscalYearQuarter,
  })
  .refine(bothOrNeither, bothOrNeitherIssue);

// Not a fixed enum — analysis-ts's own supported metricCode set for this endpoint keeps growing (started
// at 3, now 112+, see GET /metrics' hasProvenance field) and validates itself; a bad value here is relayed
// as analysis-ts's own 400 message (see metricProvenance.client.ts) rather than guessed at locally. A
// hardcoded enum here used to silently block newly-added metricCodes until this file caught up — see
// metricProvenance.types.ts's MetricProvenanceMetricCode.

/**
 * `asOfDate` 與 `periodType` 都**必須轉發**，不能只放在 schema 裡：zod 物件不是 strict，未知參數會被靜默
 * 丟掉，而這兩個參數被丟掉的後果不是「沒有效果」，是**回 200 加一個錯的答案**。2026-10-01 實測：
 *
 * ```
 * asOfDate=2026-08-01    上游 value 32.6（07-31 的值）   沒轉發時 value 28.75（最新值）
 * periodType=Q           上游 found:false + 說明           沒轉發時 found:true + TTM 的值
 * ```
 *
 * 第二個更糟：上游刻意回「這個期別沒有」，而沒轉發時連 `found` 旗標都是錯的。而且同一次上游變更新增的
 * 回應欄位 `periodType` 正是唯一能偵測它的訊號——兩個一起漏接就互相掩護，見 metricProvenance.types.ts。
 *
 * **兩個都不設 enum**：`periodType` 的合法集合是上游的（目前 Q/YTD/TTM/FY），而每支指標支援哪些期別不同；
 * `asOfDate` 只對逐日與月頻指標有作用。交給上游驗證，錯值會拿到它逐欄位的原訊息（4xx 原樣中繼）。
 */
export const metricProvenanceQuerySchema = z
  .object({
    metricCode: z.string({ error: '"metricCode" is required' }).trim().min(1, '"metricCode" is required'),
    timeframe: z.string().trim().min(1).optional(),
    asOfDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { error: '"asOfDate" must be in "YYYY-MM-DD" format, e.g. "2026-08-01"' })
      .optional(),
    ...fiscalYearQuarter,
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
    const query = parseQuery(companyListQuerySchema, req.query);
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
    const query = parseQuery(exDividendCalendarQuerySchema, req.query);
    const result = await deps.stockGateway.getExDividendCalendar(query.month);
    res.json(result);
  });

  // Mounted before the "/:symbol" catch-all below, or "preferred-stocks" would be captured as a symbol.
  stockRouter.get("/preferred-stocks", async (req, res) => {
    const query = parseQuery(preferredStocksQuerySchema, req.query);
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
    const query = parseQuery(financialStatementQuerySchema, rejectRetiredParams(req.query, { year: "fiscalYear", season: "fiscalQuarter" }));
    const statement = await deps.stockGateway.getFinancialStatement(symbol, query.statementType, query.fiscalYear, query.fiscalQuarter);
    res.json(statement);
  });

  stockRouter.get("/:symbol/metrics-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseQuery(metricsHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getMetricsHistory(symbol, query.metricCodes, query.timeframe, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/roe-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseQuery(roeRoaHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getRoeHistory(symbol, query.timeframe, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/roa-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseQuery(roeRoaHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getRoaHistory(symbol, query.timeframe, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/dupont-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseQuery(dupontHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getDupontHistory(symbol, query.timeframe, query.limit);
    res.json(history);
  });

  // 沒有 query 參數，所以沒有 zod schema 也沒有 service 層 —— 依 CLAUDE.md，純轉發不留空殼。
  stockRouter.get("/:symbol/book-value-breakdown", async (req, res) => {
    const { symbol } = req.params;
    const breakdown = await deps.stockGateway.getBookValueBreakdown(symbol);
    res.json(breakdown);
  });

  stockRouter.get("/:symbol/valuation-river", async (req, res) => {
    const { symbol } = req.params;
    const query = parseQuery(valuationRiverQuerySchema, req.query);
    const river = await deps.stockGateway.getValuationRiver(symbol, query.ratio, query.lookbackYears);
    // 一天只變一次（盤後），5 年約 1,250 列、10 年約 2,500 列。讓 web-nuxt 的 Nitro 快取可以放心存一小時。
    res.set("Cache-Control", "public, max-age=3600");
    res.json(river);
  });

  stockRouter.get("/:symbol/monthly-revenue-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseQuery(monthlyRevenueHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getMonthlyRevenueHistory(symbol, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/foreign-shareholding-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseQuery(foreignShareholdingHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getForeignShareholdingHistory(symbol, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/daily-price-history", async (req, res) => {
    const { symbol } = req.params;
    const query = parseQuery(dailyPriceHistoryQuerySchema, req.query);
    const history = await deps.stockGateway.getDailyPriceHistory(symbol, query.limit);
    res.json(history);
  });

  stockRouter.get("/:symbol/piotroski-breakdown", async (req, res) => {
    const { symbol } = req.params;
    const query = parseQuery(piotroskiBreakdownQuerySchema, rejectRetiredParams(req.query, { year: "fiscalYear", season: "fiscalQuarter" }));
    const breakdown = await deps.stockGateway.getPiotroskiBreakdown(symbol, query.fiscalYear, query.fiscalQuarter);
    res.json(breakdown);
  });

  stockRouter.get("/:symbol/metric-provenance", async (req, res) => {
    const { symbol } = req.params;
    // timeframe 在這支是選填，所以舊名 periodType 也要明確擋：靜靜丟掉會改回上游的預設期別。
    const query = parseQuery(metricProvenanceQuerySchema, rejectRetiredParams(req.query, { year: "fiscalYear", season: "fiscalQuarter", periodType: "timeframe" }));
    const provenance = await deps.stockGateway.getMetricProvenance(
      symbol,
      query.metricCode,
      query.fiscalYear,
      query.fiscalQuarter,
      query.timeframe,
      query.asOfDate,
    );
    res.json(provenance);
  });

  return stockRouter;
}
