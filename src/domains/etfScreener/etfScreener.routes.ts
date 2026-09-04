import { Router } from "ultimate-express";
import { z } from "zod";
import { parseBody } from "@/shared/validation.js";
import { getEtfFilterCatalog, runEtfScreener } from "@/domains/etfScreener/etfScreener.service.js";
import {
  DEFAULT_ETF_SCREENER_PAGE_SIZE,
  etfColumnsArraySchema,
  etfScreenerFiltersArraySchema,
  etfScreenerPaginationSchema,
  toEtfScreenerFilter,
} from "@/domains/etfScreener/etfScreenerInput.js";

export const etfScreenerRouter = Router();

etfScreenerRouter.get("/filters", async (_req, res) => {
  const catalog = await getEtfFilterCatalog();
  res.json(catalog);
});

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
    sortOrder: z.enum(["asc", "desc"], { error: '"sortOrder" must be "asc" or "desc"' }).optional(),
  })
  .refine((data) => (data.sortField === undefined) === (data.sortOrder === undefined), {
    message: '"sortField" and "sortOrder" must be given together, or not at all',
    path: ["sortField"],
  });

etfScreenerRouter.post("/", async (req, res) => {
  const body = parseBody(etfScreenerRequestSchema, req.body);
  const filters = (body.filters ?? []).map(toEtfScreenerFilter);
  const columns = body.columns ?? [];
  const page = body.page ?? 1;
  const pageSize = body.pageSize ?? DEFAULT_ETF_SCREENER_PAGE_SIZE;
  const sort = body.sortField !== undefined ? { field: body.sortField, order: body.sortOrder! } : undefined;

  const result = await runEtfScreener(filters, columns, page, pageSize, sort);
  res.json(result);
});
