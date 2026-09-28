import { describe, expect, it } from "vitest";
import { parseBody } from "@/shared/validation.js";
import {
  MARKET_LIMIT_BOUNDS,
  attentionStocksQuerySchema,
  disposedStocksQuerySchema,
  etfRankingQuerySchema,
  marginShortRatioRankingQuerySchema,
  materialAnnouncementsQuerySchema,
  priceChangeRankingQuerySchema,
  revenueRankingQuerySchema,
  taiexDailyPriceQuerySchema,
} from "@/http/modules/market/route.js";

/**
 * 取代 market.service.test.ts（2026-09-28）。原本那 320 行對著 service 傳**數字**驗界限，而 Express 給的
 * `req.query.limit` 是字串——`?limit=abc`、`?limit=` 這兩條真的會發生的路徑從來沒被覆蓋。現在驗的是
 * query 物件本身，形狀跟上線時一樣。
 *
 * 每一組界限都是對 analysis-ts 實測二分出來的（券資比 1~100、其他排行 1~50、TAIEX 1~8000），這裡守的是
 * 「改了 MARKET_LIMIT_BOUNDS 就會有東西亮」，不是 zod 本身會不會運作。
 */
const LIMIT_SCHEMAS = [
  ["margin-short-ratio-ranking", marginShortRatioRankingQuerySchema, MARKET_LIMIT_BOUNDS.marginShortRatioRanking],
  ["material-announcements", materialAnnouncementsQuerySchema, MARKET_LIMIT_BOUNDS.materialAnnouncements],
  ["disposed-stocks", disposedStocksQuerySchema, MARKET_LIMIT_BOUNDS.disposedStocks],
  ["attention-stocks", attentionStocksQuerySchema, MARKET_LIMIT_BOUNDS.attentionStocks],
  ["price-change-ranking", priceChangeRankingQuerySchema, MARKET_LIMIT_BOUNDS.priceChangeRanking],
  ["taiex-daily-price", taiexDailyPriceQuerySchema, MARKET_LIMIT_BOUNDS.taiexDailyPrice],
] as const;

describe.each(LIMIT_SCHEMAS)("%s limit", (_name, schema, bounds) => {
  it("省略時套用預設值", () => {
    expect(parseBody(schema, {}).limit).toBe(bounds.default);
  });

  // 空值當成沒給（2026-09-28 的行為改變，舊版是 Number("") = 0 然後被界限擋成 400）。
  it("空字串當成沒給", () => {
    expect(parseBody(schema, { limit: "" }).limit).toBe(bounds.default);
  });

  it("字串數字會轉成數字——Express 給的就是字串", () => {
    expect(parseBody(schema, { limit: String(bounds.max) }).limit).toBe(bounds.max);
  });

  it.each(["min", "max"] as const)("接受邊界值（%s）", (edge) => {
    expect(parseBody(schema, { limit: String(bounds[edge]) }).limit).toBe(bounds[edge]);
  });

  it("超出界限、非整數、非數字都是 400，而且訊息帶出可用範圍", () => {
    for (const bad of [String(bounds.min - 1), String(bounds.max + 1), "2.5", "abc", "1e999"]) {
      expect(() => parseBody(schema, { limit: bad }), `limit=${bad} 應該被擋下來`).toThrowError(
        new RegExp(`between ${bounds.min} and ${bounds.max}`),
      );
    }
  });
});

describe("revenue-ranking / etf-ranking 的 metric 與 order", () => {
  it("metric/order 必填，缺了就 400", () => {
    expect(() => parseBody(revenueRankingQuerySchema, { order: "desc" })).toThrowError(/"metric" must be one of yoy, mom, revenue/);
    expect(() => parseBody(revenueRankingQuerySchema, { metric: "yoy" })).toThrowError(/"order" must be one of asc, desc/);
  });

  // 大小寫不同就是不同的值：上游只認小寫，本地放行只會換成一趟往返之後的 400。
  it.each(["YOY", "bogus", ""])("不認識的 metric（%s）是 400", (metric) => {
    expect(() => parseBody(revenueRankingQuerySchema, { metric, order: "desc" })).toThrowError(/"metric" must be one of/);
  });

  it.each(["ASC", "bogus", ""])("不認識的 order（%s）是 400", (order) => {
    expect(() => parseBody(revenueRankingQuerySchema, { metric: "yoy", order })).toThrowError(/"order" must be one of/);
  });

  it("有效組合連同 limit 預設值一起出來", () => {
    expect(parseBody(revenueRankingQuerySchema, { metric: "mom", order: "asc" })).toEqual({
      metric: "mom",
      order: "asc",
      limit: MARKET_LIMIT_BOUNDS.revenueRanking.default,
    });
  });

  // 13 支都要通，不只別處順手測到的那幾支。
  it.each(["aum", "holders", "netFlow", "dcaAmount", "return3m", "return6m", "return1y", "return2y", "return3y", "return5y", "returnYtd", "return10y", "expenseRatio"])(
    "etf-ranking 接受 metric %s",
    (metric) => {
      expect(parseBody(etfRankingQuerySchema, { metric, order: "desc" }).metric).toBe(metric);
    },
  );

  it("etf-ranking 的 metric 不接受 revenue-ranking 的值", () => {
    expect(() => parseBody(etfRankingQuerySchema, { metric: "yoy", order: "desc" })).toThrowError(/"metric" must be one of/);
  });
});

describe("taiex-daily-price 的 interval", () => {
  /**
   * **沒有預設值**是刻意的：省略時 route 拿到 undefined，client 就不會送出這個參數，上游回應跟 interval
   * 這個參數存在之前逐 byte 相同。給它一個 `.default("daily")` 會悄悄破壞那個保證。
   */
  it.each([{}, { interval: "" }])("省略或空值都是 undefined，不是 daily（%j）", (query) => {
    expect(parseBody(taiexDailyPriceQuerySchema, query).interval).toBeUndefined();
  });

  it.each(["daily", "weekly", "monthly"])("接受 %s", (interval) => {
    expect(parseBody(taiexDailyPriceQuerySchema, { interval }).interval).toBe(interval);
  });

  it.each(["yearly", "DAILY", "1d"])("不認識的 interval（%s）是 400", (interval) => {
    expect(() => parseBody(taiexDailyPriceQuerySchema, { interval })).toThrowError(/"interval" must be one of daily, weekly, monthly/);
  });
});
