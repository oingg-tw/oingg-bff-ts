import { Router } from "ultimate-express";
import { z } from "zod";
import { parseBody, withLegacyQueryNames } from "@/shared/validation.js";
import { runEtfScreener, type EtfScreenerDeps } from "@/application/proxy/etfScreener/etfScreener.service.js";
import {
  DEFAULT_ETF_SCREENER_PAGE_SIZE,
  etfColumnsArraySchema,
  etfScreenerFiltersArraySchema,
  etfScreenerPaginationSchema,
  toEtfScreenerFilter,
} from "@/application/proxy/etfScreener/etfScreenerInput.js";

export const etfScreenerRequestSchema = z
  .object({
    filters: etfScreenerFiltersArraySchema.optional(),
    columns: etfColumnsArraySchema.optional(),
    page: etfScreenerPaginationSchema.shape.page,
    pageSize: etfScreenerPaginationSchema.shape.pageSize,
    sortField: z
      .string({ error: '"sortField" must be a non-empty string' })
      .trim()
      .min(1, '"sortField" must be a non-empty string')
      .optional(),
    order: z.enum(["asc", "desc"], { error: '"order" must be "asc" or "desc"' }).optional(),
  })
  .refine((data) => (data.sortField === undefined) === (data.order === undefined), {
    message: '"sortField" and "order" must be given together, or not at all',
    path: ["sortField"],
  });

/**
 * GET /filters 是純轉發（沒有本地型錄快取，沒有東西可驗），所以直接呼叫 gateway port；POST / 走
 * etfScreener.service.ts，因為那裡有「filters 與 columns 不能同時為空」這條真規則。
 * 同一個切片裡兩支端點分屬兩種處理方式，是照「這支有沒有規則」決定的，不是照切片決定的。
 */
export function createEtfScreenerRouter(deps: EtfScreenerDeps): Router {
  const etfScreenerRouter = Router();

  etfScreenerRouter.get("/filters", async (_req, res) => {
    const catalog = await deps.etfScreenerGateway.getFieldCatalog();
    res.json(catalog);
  });

  etfScreenerRouter.post("/", async (req, res) => {
    // sortOrder 是並存期舊名（2026-10-10 起叫 order，跟 analysis-ts 810da900 同名），web-nuxt 改完就刪這層。
    const body = parseBody(etfScreenerRequestSchema, withLegacyQueryNames(req.body, { sortOrder: "order" }));
    const filters = (body.filters ?? []).map(toEtfScreenerFilter);
    const columns = body.columns ?? [];
    const page = body.page ?? 1;
    const pageSize = body.pageSize ?? DEFAULT_ETF_SCREENER_PAGE_SIZE;
    const sort = body.sortField !== undefined ? { field: body.sortField, order: body.order! } : undefined;

    const result = await runEtfScreener(filters, columns, page, pageSize, sort, deps);
    res.json(result);
  });

  return etfScreenerRouter;
}
