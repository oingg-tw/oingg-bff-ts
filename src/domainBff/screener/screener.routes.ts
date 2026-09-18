import { Router } from "ultimate-express";
import { z } from "zod";
import { UUID_PATTERN } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { optionalAuth } from "@/domainBusiness/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domainBusiness/auth/auth.types.js";
import { runCompanyRank, runDistribution, runRanking, runScreener, runScreenerValues } from "@/domainBff/screener/screener.service.js";
import { resolveScreenerColumns } from "@/domainBusiness/screener/columnPresets.service.js";
import { DEFAULT_PAGE_SIZE, paginationSchema } from "@/domainBff/screener/pagination.js";
import { normalizeScreenerFilters, screenerFiltersArraySchema } from "@/domainBff/screener/screenerFilterInput.js";
import type { ScreenerColumnRef } from "@/domainBff/screener/screener.types.js";

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
    // Raw display-field keys (e.g. a ColumnPresetTemplate's own fieldKeys) — for callers who don't have
    // (or don't want to use) a personal ColumnPreset to reference by id. Added 2026-09-11 for the guest
    // "try before you sign up" screener flow: an anonymous caller has no account to own a ColumnPreset,
    // and columnPresetId is silently ignored for anonymous requests anyway (resolveScreenerColumns always
    // falls through to the system default for them) — this is the only way a guest can request a specific
    // set of display columns at all. Mutually exclusive with columnPresetId (see the refine below).
    columns: z.array(z.string().trim().min(1)).optional(),
    page: paginationSchema.shape.page,
    pageSize: paginationSchema.shape.pageSize,
    sortField: z
      .string({ error: '"sortField" must be a non-empty string' })
      .trim()
      .min(1, '"sortField" must be a non-empty string')
      .optional(),
    sortOrder: z.enum(["asc", "desc"], { error: '"sortOrder" must be "asc" or "desc"' }).optional(),
    sectorCodes: z.array(z.string().trim().min(1)).optional(),
  })
  .refine((data) => (data.sortField === undefined) === (data.sortOrder === undefined), {
    message: '"sortField" and "sortOrder" must be given together, or not at all',
    path: ["sortField"],
  })
  .refine((data) => data.columnPresetId === undefined || data.columnPresetId === null || data.columns === undefined, {
    message: '"columnPresetId" and "columns" can\'t both be given — pick one way to choose display columns',
    path: ["columns"],
  });

screenerRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = req.user?.uid;
  const body = parseBody(screenerRequestSchema, req.body);
  const filters = normalizeScreenerFilters(body.filters);
  const pagination = { page: body.page ?? 1, pageSize: body.pageSize ?? DEFAULT_PAGE_SIZE };
  const sort = body.sortField !== undefined ? { field: body.sortField, order: body.sortOrder! } : undefined;

  let columnPresetId: string | null;
  let columns: ScreenerColumnRef[];
  if (body.columns !== undefined) {
    columnPresetId = null;
    columns = body.columns.map((field) => ({ field }));
  } else {
    ({ columnPresetId, columns } = await resolveScreenerColumns(firebaseUid, body.columnPresetId ?? undefined));
  }

  const result = await runScreener(filters, columns, pagination, sort, body.sectorCodes);
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

function parseSectorCodes(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
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
  sectorCodes: z
    .string({ error: '"sectorCodes" must be a comma-separated string of sector codes' })
    .trim()
    .min(1, '"sectorCodes" must be a comma-separated string of sector codes')
    .optional(),
});

screenerRouter.get("/ranking", async (req, res) => {
  const query = parseBody(rankingQuerySchema, req.query);
  const direction = query.direction ?? "desc";
  const limit = query.limit ?? DEFAULT_RANKING_LIMIT;
  const columns = parseRankingColumns(query.columns);
  const sectorCodes = parseSectorCodes(query.sectorCodes);

  const result = await runRanking(query.field, direction, limit, columns, sectorCodes);
  res.json(result);
});

// `direction` is required with no default here (unlike GET /screener/ranking's optional-defaults-to-desc)
// — matches analysis-ts's own GET /screener/company-rank, which 400s if it's omitted (confirmed live).
export const companyRankQuerySchema = z.object({
  symbol: z.string({ error: '"symbol" query parameter is required' }).trim().min(1, '"symbol" query parameter is required'),
  field: z.string({ error: '"field" query parameter is required' }).trim().min(1, '"field" query parameter is required'),
  direction: z.enum(["asc", "desc"], { error: '"direction" query parameter is required and must be "asc" or "desc"' }),
});

screenerRouter.get("/company-rank", async (req, res) => {
  const query = parseBody(companyRankQuerySchema, req.query);
  const result = await runCompanyRank(query.symbol, query.field, query.direction);
  res.json(result);
});

export const distributionQuerySchema = z.object({
  field: z.string({ error: '"field" query parameter is required' }).trim().min(1, '"field" query parameter is required'),
  bins: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z
      .coerce.number({ error: '"bins" must be a positive integer' })
      .refine((n) => Number.isInteger(n) && n > 0, { message: '"bins" must be a positive integer' })
      .optional(),
  ),
  excludeZero: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z.enum(["true", "false"], { error: '"excludeZero" must be "true" or "false"' }).transform((v) => v === "true").optional(),
  ),
});

screenerRouter.get("/distribution", async (req, res) => {
  const query = parseBody(distributionQuerySchema, req.query);
  const result = await runDistribution(query.field, query.bins, query.excludeZero);
  res.json(result);
});
