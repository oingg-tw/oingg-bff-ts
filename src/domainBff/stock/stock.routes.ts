import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { parseBody } from "@/shared/validation.js";
import {
  getCapitalStockHistory,
  getCompanyProfile,
  getExDividendNotices,
  getFinancialStatement,
  getStockQuote,
} from "@/domainBff/stock/stock.service.js";

const MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST = 100;

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
