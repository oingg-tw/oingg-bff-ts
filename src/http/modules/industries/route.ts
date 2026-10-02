import { Router } from "ultimate-express";
import type { AppDeps } from "@/application/deps.js";

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

  return industriesRouter;
}
