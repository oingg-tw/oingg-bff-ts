import { Router } from "ultimate-express";
import { z } from "zod";
import { parseBody } from "@/shared/validation.js";
import type { AppDeps } from "@/application/deps.js";

export type MarketDeps = Pick<AppDeps, "marketGateway">;

/**
 * 界限與列舉都對齊 analysis-ts 自己的驗證（每一組都是實測二分出來的，見下面的表），在這裡再擋一次是為了
 * 換一個不用跨服務往返的 400——不是不信任上游。
 *
 * 2026-09-28 從 market.service.ts 搬進來：那個檔案只有這些檢查加一行轉發，八支端點各自手寫一次
 * `!Number.isInteger(limit) || limit < MIN_X || limit > MAX_X`（223 行、24 個 MIN/MAX/DEFAULT 常數）。
 * 改成 route 的 zod schema 之後跟 macro 切片同一個形狀，而且驗的是**真正會進來的東西**：Express 給的
 * `req.query.limit` 是字串，舊測試直接拿數字呼叫 service，所以 `?limit=abc` 這條路徑從來沒被測到。
 *
 * 一併改掉的行為：`?limit=`（給了參數但空值）以前 `Number("")` 變 0、被界限擋成 400，現在跟 macro 一樣
 * 當成「沒給」用預設值。空字串是前端少帶一個值的常見意外，不值得回 400。
 */
export const MARKET_LIMIT_BOUNDS = {
  // 1~100，實測二分（2026-09-01）。這支比其他排行寬，上游就是這樣定的。
  marginShortRatioRanking: { default: 20, min: 1, max: 100 },
  materialAnnouncements: { default: 20, min: 1, max: 50 },
  revenueRanking: { default: 20, min: 1, max: 50 },
  disposedStocks: { default: 20, min: 1, max: 50 },
  attentionStocks: { default: 20, min: 1, max: 50 },
  priceChangeRanking: { default: 20, min: 1, max: 50 },
  etfRanking: { default: 20, min: 1, max: 50 },
  // 2000 → 8000（2026-09-22，analysis-ts 113dd818）讓 interval=daily 能一次取回 1999 起的完整日線（約 6,900 筆）。
  taiexDailyPrice: { default: 250, min: 1, max: 8000 },
} as const;

type LimitBounds = { readonly default: number; readonly min: number; readonly max: number };

/**
 * openapi.ts 也讀 MARKET_LIMIT_BOUNDS，所以界限只有一份——以前 service 的常數與 OpenAPI 的字面數字是
 * 兩份，改上限時很容易只改一邊（文件寫 2000、實際收 8000 這種）。
 */
export function limitQuerySchema(bounds: LimitBounds) {
  const message = `"limit" must be an integer between ${bounds.min} and ${bounds.max}`;
  return z.object({
    limit: z.preprocess(
      (v) => (v === undefined || v === "" ? undefined : v),
      z.coerce.number({ error: message }).int(message).min(bounds.min, message).max(bounds.max, message).default(bounds.default),
    ),
  });
}

/** metric／order 上游沒有預設值，必填；缺值與不認識的值都回同一句（那句已經把可用值列出來了）。 */
function requiredEnum<const T extends readonly [string, ...string[]]>(name: string, values: T) {
  return z.enum(values, { error: `"${name}" must be one of ${values.join(", ")}` });
}

const REVENUE_RANKING_METRICS = ["yoy", "mom", "revenue"] as const;
const RANKING_ORDERS = ["asc", "desc"] as const;
const ETF_RANKING_METRICS = [
  "aum",
  "holders",
  "netFlow",
  "dcaAmount",
  "return3m",
  "return6m",
  "return1y",
  "return2y",
  "return3y",
  "return5y",
  "returnYtd",
  "return10y",
  "expenseRatio",
] as const;
const TAIEX_DAILY_PRICE_INTERVALS = ["daily", "weekly", "monthly"] as const;

export const marginShortRatioRankingQuerySchema = limitQuerySchema(MARKET_LIMIT_BOUNDS.marginShortRatioRanking);
export const materialAnnouncementsQuerySchema = limitQuerySchema(MARKET_LIMIT_BOUNDS.materialAnnouncements);
export const disposedStocksQuerySchema = limitQuerySchema(MARKET_LIMIT_BOUNDS.disposedStocks);
export const attentionStocksQuerySchema = limitQuerySchema(MARKET_LIMIT_BOUNDS.attentionStocks);
export const priceChangeRankingQuerySchema = limitQuerySchema(MARKET_LIMIT_BOUNDS.priceChangeRanking);

export const revenueRankingQuerySchema = limitQuerySchema(MARKET_LIMIT_BOUNDS.revenueRanking).extend({
  metric: requiredEnum("metric", REVENUE_RANKING_METRICS),
  order: requiredEnum("order", RANKING_ORDERS),
});

export const etfRankingQuerySchema = limitQuerySchema(MARKET_LIMIT_BOUNDS.etfRanking).extend({
  metric: requiredEnum("metric", ETF_RANKING_METRICS),
  order: requiredEnum("order", RANKING_ORDERS),
});

/**
 * symbol 由這裡先擋：上游缺 symbol 時回的是嵌套的 zod 樹，最上層只寫「Invalid query parameters.」
 * （2026-10-05 實測），轉出去之後前端看不出是哪個參數錯。
 */
export const etfDistributionsQuerySchema = z.object({
  symbol: z.string({ error: '"symbol" is required' }).trim().min(1, '"symbol" is required'),
});

export const taiexDailyPriceQuerySchema = limitQuerySchema(MARKET_LIMIT_BOUNDS.taiexDailyPrice).extend({
  /**
   * 選填而且**沒有預設值**：省略時不送出這個參數，上游回應才會跟 interval 存在之前逐 byte 相同
   * （見 marketRankings.client.ts 的 fetchTaiexDailyPrice）。空字串照 optional 處理，理由同 limit。
   */
  interval: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    requiredEnum("interval", TAIEX_DAILY_PRICE_INTERVALS).optional(),
  ),
});

/**
 * 純轉發切片：route 直接呼叫 gateway port，中間沒有 service 層（跟 macro 一樣）。驗證留在上面的 zod
 * schema，它同時是 OpenAPI 的來源。
 */
export function createMarketRouter(deps: MarketDeps): Router {
  const marketRouter = Router();

  marketRouter.get("/margin-short-ratio-ranking", async (req, res) => {
    const { limit } = parseBody(marginShortRatioRankingQuerySchema, req.query);
    res.json(await deps.marketGateway.getMarginShortRatioRanking(limit));
  });

  marketRouter.get("/material-announcements", async (req, res) => {
    const { limit } = parseBody(materialAnnouncementsQuerySchema, req.query);
    res.json(await deps.marketGateway.getMaterialAnnouncements(limit));
  });

  marketRouter.get("/revenue-ranking", async (req, res) => {
    const { metric, order, limit } = parseBody(revenueRankingQuerySchema, req.query);
    res.json(await deps.marketGateway.getRevenueRanking(metric, order, limit));
  });

  marketRouter.get("/volume-top20", async (_req, res) => {
    res.json(await deps.marketGateway.getVolumeTop20());
  });

  marketRouter.get("/disposed-stocks", async (req, res) => {
    const { limit } = parseBody(disposedStocksQuerySchema, req.query);
    res.json(await deps.marketGateway.getDisposedStocks(limit));
  });

  marketRouter.get("/attention-stocks", async (req, res) => {
    const { limit } = parseBody(attentionStocksQuerySchema, req.query);
    res.json(await deps.marketGateway.getAttentionStocks(limit));
  });

  marketRouter.get("/price-change-ranking", async (req, res) => {
    const { limit } = parseBody(priceChangeRankingQuerySchema, req.query);
    res.json(await deps.marketGateway.getPriceChangeRanking(limit));
  });

  marketRouter.get("/etf-ranking", async (req, res) => {
    const { metric, order, limit } = parseBody(etfRankingQuerySchema, req.query);
    res.json(await deps.marketGateway.getEtfRanking(metric, order, limit));
  });

  marketRouter.get("/etf-distributions", async (req, res) => {
    const { symbol } = parseBody(etfDistributionsQuerySchema, req.query);
    res.json(await deps.marketGateway.getEtfDistributions(symbol));
  });

  marketRouter.get("/taiex-daily-price", async (req, res) => {
    const { limit, interval } = parseBody(taiexDailyPriceQuerySchema, req.query);
    res.json(await deps.marketGateway.getTaiexDailyPrice(limit, interval));
  });

  return marketRouter;
}
