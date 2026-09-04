import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import {
  DEFAULT_ATTENTION_STOCKS_LIMIT,
  DEFAULT_DISPOSED_STOCKS_LIMIT,
  DEFAULT_ETF_RANKING_LIMIT,
  DEFAULT_FOREIGN_HOLDING_LIMIT,
  DEFAULT_MARGIN_SHORT_LIMIT,
  DEFAULT_MATERIAL_ANNOUNCEMENTS_LIMIT,
  DEFAULT_PRICE_CHANGE_RANKING_LIMIT,
  DEFAULT_REVENUE_RANKING_LIMIT,
  getAttentionStocks,
  getDisposedStocks,
  getEtfRanking,
  getForeignHoldingRanking,
  getMarginShortRatioRanking,
  getMaterialAnnouncements,
  getPriceChangeRanking,
  getPriceLimitRange,
  getRevenueRanking,
  getVolumeTop20,
} from "@/domains/market/market.service.js";

export const marketRouter = Router();

function parseIntQueryParam(raw: unknown, name: string, defaultValue: number): number {
  if (raw === undefined) {
    return defaultValue;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value)) {
    throw new AppError(`"${name}" must be an integer`, 400);
  }
  return value;
}

/** analysis-ts requires this param with no default — fail fast with the same message shape as an unknown/bad value. */
function requireStringQueryParam(raw: unknown, name: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new AppError(`"${name}" is required`, 400);
  }
  return raw;
}

marketRouter.get("/foreign-holding-ranking", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_FOREIGN_HOLDING_LIMIT);
  const result = await getForeignHoldingRanking(limit);
  res.json(result);
});

marketRouter.get("/margin-short-ratio-ranking", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_MARGIN_SHORT_LIMIT);
  const result = await getMarginShortRatioRanking(limit);
  res.json(result);
});

marketRouter.get("/material-announcements", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_MATERIAL_ANNOUNCEMENTS_LIMIT);
  const result = await getMaterialAnnouncements(limit);
  res.json(result);
});

marketRouter.get("/revenue-ranking", async (req, res) => {
  const metric = requireStringQueryParam(req.query.metric, "metric");
  const order = requireStringQueryParam(req.query.order, "order");
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_REVENUE_RANKING_LIMIT);
  const result = await getRevenueRanking(metric, order, limit);
  res.json(result);
});

marketRouter.get("/volume-top20", async (_req, res) => {
  const result = await getVolumeTop20();
  res.json(result);
});

marketRouter.get("/disposed-stocks", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_DISPOSED_STOCKS_LIMIT);
  const result = await getDisposedStocks(limit);
  res.json(result);
});

marketRouter.get("/attention-stocks", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_ATTENTION_STOCKS_LIMIT);
  const result = await getAttentionStocks(limit);
  res.json(result);
});

marketRouter.get("/price-limit-range", async (_req, res) => {
  const result = await getPriceLimitRange();
  res.json(result);
});

marketRouter.get("/price-change-ranking", async (req, res) => {
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_PRICE_CHANGE_RANKING_LIMIT);
  const result = await getPriceChangeRanking(limit);
  res.json(result);
});

marketRouter.get("/etf-ranking", async (req, res) => {
  const metric = requireStringQueryParam(req.query.metric, "metric");
  const order = requireStringQueryParam(req.query.order, "order");
  const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_ETF_RANKING_LIMIT);
  const result = await getEtfRanking(metric, order, limit);
  res.json(result);
});
