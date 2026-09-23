import { Router } from "ultimate-express";
import { AppError } from "@/domain/appError.js";
import {
  DEFAULT_ATTENTION_STOCKS_LIMIT,
  DEFAULT_DISPOSED_STOCKS_LIMIT,
  DEFAULT_ETF_RANKING_LIMIT,
  DEFAULT_MARGIN_SHORT_LIMIT,
  DEFAULT_MATERIAL_ANNOUNCEMENTS_LIMIT,
  DEFAULT_PRICE_CHANGE_RANKING_LIMIT,
  DEFAULT_REVENUE_RANKING_LIMIT,
  DEFAULT_TAIEX_DAILY_PRICE_LIMIT,
  getAttentionStocks,
  getDisposedStocks,
  getEtfRanking,
  getMarginShortRatioRanking,
  getMaterialAnnouncements,
  getPriceChangeRanking,
  getPriceLimitRange,
  getRevenueRanking,
  getTaiexDailyPrice,
  getVolumeTop20,
  type MarketDeps,
} from "@/application/proxy/market/market.service.js";

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

/**
 * 這個切片跟 macro 不同，中間留著 market.service.ts：界限與 metric/order 列舉驗證都在那裡（對齊
 * analysis-ts 自己的規則，換一個不用跨服務往返的 400）。route 只負責解 query 與寫回應。
 *
 * 改成工廠函式純粹是為了把 gateway port 傳進 service，驗證規則與預設值一行都沒動。
 */
export function createMarketRouter(deps: MarketDeps): Router {
  const marketRouter = Router();

  marketRouter.get("/margin-short-ratio-ranking", async (req, res) => {
    const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_MARGIN_SHORT_LIMIT);
    const result = await getMarginShortRatioRanking(limit, deps);
    res.json(result);
  });

  marketRouter.get("/material-announcements", async (req, res) => {
    const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_MATERIAL_ANNOUNCEMENTS_LIMIT);
    const result = await getMaterialAnnouncements(limit, deps);
    res.json(result);
  });

  marketRouter.get("/revenue-ranking", async (req, res) => {
    const metric = requireStringQueryParam(req.query.metric, "metric");
    const order = requireStringQueryParam(req.query.order, "order");
    const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_REVENUE_RANKING_LIMIT);
    const result = await getRevenueRanking(metric, order, limit, deps);
    res.json(result);
  });

  marketRouter.get("/volume-top20", async (_req, res) => {
    const result = await getVolumeTop20(deps);
    res.json(result);
  });

  marketRouter.get("/disposed-stocks", async (req, res) => {
    const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_DISPOSED_STOCKS_LIMIT);
    const result = await getDisposedStocks(limit, deps);
    res.json(result);
  });

  marketRouter.get("/attention-stocks", async (req, res) => {
    const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_ATTENTION_STOCKS_LIMIT);
    const result = await getAttentionStocks(limit, deps);
    res.json(result);
  });

  marketRouter.get("/price-limit-range", async (_req, res) => {
    const result = await getPriceLimitRange(deps);
    res.json(result);
  });

  marketRouter.get("/price-change-ranking", async (req, res) => {
    const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_PRICE_CHANGE_RANKING_LIMIT);
    const result = await getPriceChangeRanking(limit, deps);
    res.json(result);
  });

  marketRouter.get("/etf-ranking", async (req, res) => {
    const metric = requireStringQueryParam(req.query.metric, "metric");
    const order = requireStringQueryParam(req.query.order, "order");
    const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_ETF_RANKING_LIMIT);
    const result = await getEtfRanking(metric, order, limit, deps);
    res.json(result);
  });

  marketRouter.get("/taiex-daily-price", async (req, res) => {
    const limit = parseIntQueryParam(req.query.limit, "limit", DEFAULT_TAIEX_DAILY_PRICE_LIMIT);
    const interval = typeof req.query.interval === "string" && req.query.interval.length > 0 ? req.query.interval : undefined;
    const result = await getTaiexDailyPrice(limit, interval, deps);
    res.json(result);
  });

  return marketRouter;
}
