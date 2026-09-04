import { Router } from "ultimate-express";
import { z } from "zod";
import { UUID_PATTERN } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { optionalAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import { runRanking, runScreener, runScreenerValues } from "@/domains/screener/screener.service.js";
import { resolveScreenerColumns } from "@/domains/screener/columnPresets.service.js";
import { DEFAULT_PAGE_SIZE, paginationSchema } from "@/domains/screener/pagination.js";
import { normalizeScreenerFilters, screenerFiltersArraySchema } from "@/domains/screener/screenerFilterInput.js";
import type { ScreenerColumnRef } from "@/domains/screener/screener.types.js";

const DEFAULT_RANKING_LIMIT = 10;
const MAX_RANKING_LIMIT = 50;

export const screenerRouter = Router();

// Guests can screen without an account — only saving a filter set as a named preset
// (POST /screener/presets) requires signing in. A valid token still personalizes the
// column resolution below (the caller's own default column preset); no token just falls
// through to the system default columns.
screenerRouter.use(optionalAuth);

export const screenerRequestSchema = z
  .object({
    filters: screenerFiltersArraySchema,
    columnPresetId: z
      .string({ error: '"columnPresetId" must be a UUID string' })
      .regex(UUID_PATTERN, { error: '"columnPresetId" must be a valid UUID' })
      .nullish(),
    page: paginationSchema.shape.page,
    pageSize: paginationSchema.shape.pageSize,
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

screenerRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = req.user?.uid;
  const body = parseBody(screenerRequestSchema, req.body);
  const filters = normalizeScreenerFilters(body.filters);
  const requestedColumnPresetId = body.columnPresetId ?? undefined;
  const pagination = { page: body.page ?? 1, pageSize: body.pageSize ?? DEFAULT_PAGE_SIZE };
  const sort = body.sortField !== undefined ? { field: body.sortField, order: body.sortOrder! } : undefined;

  const { columnPresetId, columns } = await resolveScreenerColumns(firebaseUid, requestedColumnPresetId);
  const result = await runScreener(filters, columns, pagination, sort);
  res.json({ ...result, columnPresetId });
});

export const screenerValuesRequestSchema = z.object({
  symbols: z.array(z.string().trim().min(1)).min(1, '"symbols" must be a non-empty array of strings'),
  columns: z.array(z.object({ field: z.string().trim().min(1) })).min(1, '"columns" must be a non-empty array'),
});

screenerRouter.post("/values", async (req, res) => {
  const body = parseBody(screenerValuesRequestSchema, req.body);
  const result = await runScreenerValues(body.symbols, body.columns);
  res.json(result);
});

function parseRankingColumns(raw: string | undefined): ScreenerColumnRef[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean)
    .map((field) => ({ field }));
}

export const rankingQuerySchema = z.object({
  field: z.string({ error: '"field" query parameter is required' }).trim().min(1, '"field" query parameter is required'),
  direction: z.enum(["asc", "desc"], { error: '"direction" must be "asc" or "desc"' }).optional(),
  limit: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z
      .coerce.number({ error: '"limit" must be a positive integer' })
      .refine((n) => Number.isInteger(n) && n > 0, { message: '"limit" must be a positive integer' })
      .refine((n) => n <= MAX_RANKING_LIMIT, { message: `"limit" must be at most ${MAX_RANKING_LIMIT}` })
      .optional(),
  ),
  columns: z
    .string({ error: '"columns" must be a comma-separated string of fields' })
    .trim()
    .min(1, '"columns" must be a comma-separated string of fields')
    .optional(),
});

screenerRouter.get("/ranking", async (req, res) => {
  const query = parseBody(rankingQuerySchema, req.query);
  const direction = query.direction ?? "desc";
  const limit = query.limit ?? DEFAULT_RANKING_LIMIT;
  const columns = parseRankingColumns(query.columns);

  const result = await runRanking(query.field, direction, limit, columns);
  res.json(result);
});
