import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { parseBody } from "@/shared/validation.js";
import {
  getCapitalStockHistory,
  getCompanyProfile,
  getDailyPriceHistory,
  getDupontHistory,
  getExDividendCalendar,
  getExDividendNotices,
  getFinancialStatement,
  getForeignShareholdingHistory,
  getMetricHistory,
  getMetricsHistory,
  getMonthlyRevenueHistory,
  getPiotroskiBreakdown,
  getPreferredStockFieldCatalog,
  getPreferredStocks,
  getRoaHistory,
  getRoeHistory,
  getStockQuote,
} from "@/domainBff/stock/stock.service.js";

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

export const stockRouter = Router();

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
  const notices = await getExDividendNotices(symbols);
  res.json({ notices: Object.fromEntries(notices) });
});

const YYYY_MM_PATTERN = /^\d{4}-\d{2}$/;

export const exDividendCalendarQuerySchema = z.object({
  month: z
    .string({ error: '"month" is required' })
    .regex(YYYY_MM_PATTERN, { error: '"month" must be in "YYYY-MM" format, e.g. "2026-09"' }),
});

// Mounted before the "/:symbol" catch-all below, or "ex-dividend-calendar" would be captured as a symbol.
stockRouter.get("/ex-dividend-calendar", async (req, res) => {
  const query = parseBody(exDividendCalendarQuerySchema, req.query);
  const result = await getExDividendCalendar(query.month);
  res.json(result);
});

export const preferredStocksQuerySchema = z.object({
  symbol: z.string().trim().min(1, '"symbol" must be a non-empty string').optional(),
});

// Mounted before the "/:symbol" catch-all below, or "preferred-stocks" would be captured as a symbol.
stockRouter.get("/preferred-stocks", async (req, res) => {
  const query = parseBody(preferredStocksQuerySchema, req.query);
  const result = await getPreferredStocks(query.symbol);
  res.json(result);
});

// Static, param-free — analysis-ts confirmed no DB query, same response every time (2026-09-08).
stockRouter.get("/preferred-stocks/field-catalog", async (_req, res) => {
  const result = await getPreferredStockFieldCatalog();
  res.json(result);
});

stockRouter.get("/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const quote = await getStockQuote(symbol);
  if (!quote) {
    throw new AppError(`No stock data found for symbol "${symbol}"`, 404);
  }
  res.json(quote);
});

stockRouter.get("/:symbol/profile", async (req, res) => {
  const { symbol } = req.params;
  const profile = await getCompanyProfile(symbol);
  if (!profile) {
    throw new AppError(`No company profile found for symbol "${symbol}"`, 404);
  }
  res.json(profile);
});

stockRouter.get("/:symbol/capital-stock-history", async (req, res) => {
  const { symbol } = req.params;
  const history = await getCapitalStockHistory(symbol);
  res.json(history);
});

export const financialStatementQuerySchema = z
  .object({
    statementType: z.enum(["balanceSheet", "incomeStatement", "cashFlowStatement"], {
      error: '"statementType" must be "balanceSheet", "incomeStatement", or "cashFlowStatement"',
    }),
    year: z.string().trim().min(1, '"year" must be a non-empty string').optional(),
    season: z.string().trim().min(1, '"season" must be a non-empty string').optional(),
  })
  .refine((data) => (data.year === undefined) === (data.season === undefined), {
    message: '"year" and "season" must be given together, or not at all',
    path: ["year"],
  });

stockRouter.get("/:symbol/financial-statement", async (req, res) => {
  const { symbol } = req.params;
  const query = parseBody(financialStatementQuerySchema, req.query);
  const statement = await getFinancialStatement(symbol, query.statementType, query.year, query.season);
  res.json(statement);
});

export const metricHistoryQuerySchema = z.object({
  metricCode: z.enum(["eps", "peRatio", "pbRatio", "bvps", "stockPrice"], {
    error: '"metricCode" must be "eps", "peRatio", "pbRatio", "bvps", or "stockPrice"',
  }),
  basis: z.enum(["TTM", "Q"], { error: '"basis" must be "TTM" or "Q"' }),
  limit: historyLimitSchema,
});

stockRouter.get("/:symbol/metric-history", async (req, res) => {
  const { symbol } = req.params;
  const query = parseBody(metricHistoryQuerySchema, req.query);
  const history = await getMetricHistory(symbol, query.metricCode, query.basis, query.limit);
  res.json(history);
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

stockRouter.get("/:symbol/metrics-history", async (req, res) => {
  const { symbol } = req.params;
  const query = parseBody(metricsHistoryQuerySchema, req.query);
  const history = await getMetricsHistory(symbol, query.metricCodes, query.basis, query.limit);
  res.json(history);
});

export const roeRoaHistoryQuerySchema = z.object({
  basis: z.enum(["Q", "Q_ANN", "TTM"], { error: '"basis" must be "Q", "Q_ANN", or "TTM"' }),
  limit: historyLimitSchema,
});

stockRouter.get("/:symbol/roe-history", async (req, res) => {
  const { symbol } = req.params;
  const query = parseBody(roeRoaHistoryQuerySchema, req.query);
  const history = await getRoeHistory(symbol, query.basis, query.limit);
  res.json(history);
});

stockRouter.get("/:symbol/roa-history", async (req, res) => {
  const { symbol } = req.params;
  const query = parseBody(roeRoaHistoryQuerySchema, req.query);
  const history = await getRoaHistory(symbol, query.basis, query.limit);
  res.json(history);
});

export const dupontHistoryQuerySchema = z.object({
  basis: z.enum(["Q", "TTM"], { error: '"basis" must be "Q" or "TTM"' }),
  limit: historyLimitSchema,
});

stockRouter.get("/:symbol/dupont-history", async (req, res) => {
  const { symbol } = req.params;
  const query = parseBody(dupontHistoryQuerySchema, req.query);
  const history = await getDupontHistory(symbol, query.basis, query.limit);
  res.json(history);
});

// analysis-ts's own bound for this endpoint is 1-120, NOT the same 1-40 as the other history endpoints
// above — confirmed live, 2026-09-07.
export const monthlyRevenueHistoryQuerySchema = z.object({
  limit: limitSchema(1, 120),
});

stockRouter.get("/:symbol/monthly-revenue-history", async (req, res) => {
  const { symbol } = req.params;
  const query = parseBody(monthlyRevenueHistoryQuerySchema, req.query);
  const history = await getMonthlyRevenueHistory(symbol, query.limit);
  res.json(history);
});

// analysis-ts's own bound for this endpoint is 1-1500 (confirmed live, 2026-09-08) — much wider than
// the other history endpoints since this is daily (not quarterly/monthly) data.
export const foreignShareholdingHistoryQuerySchema = z.object({
  limit: limitSchema(1, 1500),
});

stockRouter.get("/:symbol/foreign-shareholding-history", async (req, res) => {
  const { symbol } = req.params;
  const query = parseBody(foreignShareholdingHistoryQuerySchema, req.query);
  const history = await getForeignShareholdingHistory(symbol, query.limit);
  res.json(history);
});

// analysis-ts's own bound for this endpoint is 1-2000 (confirmed live, 2026-09-10).
export const dailyPriceHistoryQuerySchema = z.object({
  limit: limitSchema(1, 2000),
});

stockRouter.get("/:symbol/daily-price-history", async (req, res) => {
  const { symbol } = req.params;
  const query = parseBody(dailyPriceHistoryQuerySchema, req.query);
  const history = await getDailyPriceHistory(symbol, query.limit);
  res.json(history);
});

export const piotroskiBreakdownQuerySchema = z
  .object({
    year: z.string().trim().min(1, '"year" must be a non-empty string').optional(),
    season: z.string().trim().min(1, '"season" must be a non-empty string').optional(),
  })
  .refine((data) => (data.year === undefined) === (data.season === undefined), {
    message: '"year" and "season" must be given together, or not at all',
    path: ["year"],
  });

stockRouter.get("/:symbol/piotroski-breakdown", async (req, res) => {
  const { symbol } = req.params;
  const query = parseBody(piotroskiBreakdownQuerySchema, req.query);
  const breakdown = await getPiotroskiBreakdown(symbol, query.year, query.season);
  res.json(breakdown);
});
