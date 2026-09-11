import { Router } from "ultimate-express";
import { requireFilterSyncSecret } from "@/domainBusiness/metricCatalog/filterSyncAuth.js";
import { getMetricCatalog, syncMetricCatalog } from "@/domainBusiness/metricCatalog/metricCatalog.service.js";

export const metricCatalogRouter = Router();

metricCatalogRouter.get("/", async (_req, res) => {
  const categories = await getMetricCatalog();
  res.json({ categories });
});

/**
 * Manual re-pull of analysis-ts's catalog into bff-ts's own DB, protected by requireFilterSyncSecret —
 * added 2026-09-09 after repeatedly having to restart the whole dev server just to pick up a category/
 * metric display-copy tweak on analysis-ts's side. Still bff-ts-initiated (analysis-ts doesn't call this;
 * a human or an internal tool does), so the "analysis-ts must not know bff-ts exists" boundary holds.
 */
metricCatalogRouter.post("/sync", requireFilterSyncSecret, async (_req, res) => {
  const summary = await syncMetricCatalog();
  res.json(summary);
});
