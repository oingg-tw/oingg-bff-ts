import { Router } from "ultimate-express";
import { getEtfFilterCatalog, runEtfScreener } from "@/domains/etfScreener/etfScreener.service.js";
import {
  parseEtfColumns,
  parseEtfScreenerFilters,
  parseEtfScreenerPagination,
  parseEtfSort,
} from "@/domains/etfScreener/etfScreenerInput.js";

export const etfScreenerRouter = Router();

etfScreenerRouter.get("/filters", async (_req, res) => {
  const catalog = await getEtfFilterCatalog();
  res.json(catalog);
});

etfScreenerRouter.post("/", async (req, res) => {
  const body = req.body as
    | { filters?: unknown; columns?: unknown; page?: unknown; pageSize?: unknown; sortField?: unknown; sortOrder?: unknown }
    | null;
  const filters = parseEtfScreenerFilters(body?.filters);
  const columns = parseEtfColumns(body?.columns);
  const { page, pageSize } = parseEtfScreenerPagination(body?.page, body?.pageSize);
  const sort = parseEtfSort(body?.sortField, body?.sortOrder);

  const result = await runEtfScreener(filters, columns, page, pageSize, sort);
  res.json(result);
});
