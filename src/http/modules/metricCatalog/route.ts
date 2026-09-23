import { Router } from "ultimate-express";
import { requireFilterSyncSecret } from "@/http/middleware/filterSyncAuth.js";
import {
  getMetricCatalog,
  syncMetricCatalog,
  type MetricCatalogSyncDeps,
} from "@/application/metricCatalog/metricCatalog.service.js";

/**
 * 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。
 *
 * 收的是 MetricCatalogSyncDeps（storage + gateway）而不是兩個分開的型別：GET 只要 storage，POST /sync
 * 兩個都要，取聯集就是這支路由真正碰得到的東西。
 */
export function createMetricCatalogRouter(deps: MetricCatalogSyncDeps): Router {
  const metricCatalogRouter = Router();

  metricCatalogRouter.get("/", async (_req, res) => {
    const categories = await getMetricCatalog(deps);
    res.json({ categories });
  });

  /**
   * Manual re-pull of analysis-ts's catalog into bff-ts's own DB, protected by requireFilterSyncSecret —
   * added 2026-09-09 after repeatedly having to restart the whole dev server just to pick up a category/
   * metric display-copy tweak on analysis-ts's side. Still bff-ts-initiated (analysis-ts doesn't call this;
   * a human or an internal tool does), so the "analysis-ts must not know bff-ts exists" boundary holds.
   */
  metricCatalogRouter.post("/sync", requireFilterSyncSecret, async (_req, res) => {
    const summary = await syncMetricCatalog(deps);
    res.json(summary);
  });

  return metricCatalogRouter;
}
