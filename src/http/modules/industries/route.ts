import { Router } from "ultimate-express";
import { z } from "zod";
import type { AppDeps } from "@/application/deps.js";
import { limitSchema, parseQuery } from "@/shared/validation.js";

export type IndustriesDeps = Pick<AppDeps, "industriesGateway">;

/**
 * 純轉發切片：route 直接呼叫 gateway port，中間沒有 service 層（見 industries.client.ts 的說明）。
 *
 * 2026-10-02 移除 `/tree` 與 `/flat`（財政部稅籍五層分類，資料來自 gov-ts）：上游整組下架、端點已回 404，
 * 而留著轉發等於永久回 **502**——502 的語意是「上游或我壞了」，所以任何探測它的人會把一次正常的退役讀成
 * 故障。移除後是 bff-ts 自己的 404「Route not found」，那才是誠實的語意（同 price-limit-range 的判斷）。
 *
 * 刪除依據是 **web-nuxt 的 grep：零呼叫端**（結構性證據），不是我這邊的流量統計——後者是 8 天 249,939 筆
 * 請求 0 次，但那個窗的採樣有缺口（他們的站台檢查只涵蓋腳本 ROUTES 清單裡的 69 條路由，不是全站頁面）。
 */
/**
 * 類股分布三支（2026-10-09）。驗證只做到形狀：metricCode／timeframe 不列舉（timeframe 2026-10-10 前叫 basis，並存期仍收）——哪些指標、哪些期別合法由上游判斷
 * （每股類、非季報型回 400 並帶 code），在這裡列舉等於每加一支指標就要動業務中台。對外跟上游同名 timeframe。
 */
export const sectorMetricHistoryQuerySchema = z.object({
  metricCode: z.string({ error: '"metricCode" is required' }).trim().min(1, '"metricCode" is required'),
  timeframe: z.string({ error: '"timeframe" is required' }).trim().min(1, '"timeframe" is required'),
  limit: limitSchema(1, 40),
});

// 上限跟 analysis-ts 一起從 120 調到 132（2026-10-10，758a2b90）：月營收回補目標是 2016-01，到 2026-08 約 128 個月。
export const sectorMonthlyRevenueHistoryQuerySchema = z.object({ limit: limitSchema(1, 132) });

/** fields 原樣轉給上游（逗號分隔，最多 10 個由上游驗）；這裡只擋空值。 */
export const sectorSummaryQuerySchema = z.object({
  fields: z.string({ error: '"fields" is required' }).trim().min(1, '"fields" is required'),
});

export function createIndustriesRouter(deps: IndustriesDeps): Router {
  const industriesRouter = Router();

  industriesRouter.get("/securities-sectors", async (_req, res) => {
    const list = await deps.industriesGateway.getSecuritiesSectors();
    res.json(list);
  });

  // 沒有 query 參數，所以沒有 zod schema——純轉發不留空殼，同 book-value-breakdown。
  industriesRouter.get("/sector-dividend-summary", async (_req, res) => {
    const summary = await deps.industriesGateway.getSectorDividendSummary();
    res.json(summary);
  });

  industriesRouter.get("/sector-summary", async (req, res) => {
    const query = parseQuery(sectorSummaryQuerySchema, req.query);
    res.json(await deps.industriesGateway.getSectorSummary(query.fields));
  });

  industriesRouter.get("/:sectorCode/metric-history", async (req, res) => {
    const query = parseQuery(sectorMetricHistoryQuerySchema, req.query);
    res.json(await deps.industriesGateway.getSectorMetricHistory(req.params.sectorCode ?? "", query.metricCode, query.timeframe, query.limit));
  });

  industriesRouter.get("/:sectorCode/monthly-revenue-history", async (req, res) => {
    const query = parseQuery(sectorMonthlyRevenueHistoryQuerySchema, req.query);
    res.json(await deps.industriesGateway.getSectorMonthlyRevenueHistory(req.params.sectorCode ?? "", query.limit));
  });

  return industriesRouter;
}
