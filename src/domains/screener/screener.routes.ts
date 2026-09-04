import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { optionalAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import { runRanking, runScreener, runScreenerValues } from "@/domains/screener/screener.service.js";
import { resolveScreenerColumns } from "@/domains/screener/columnPresets.service.js";
import { parsePagination } from "@/domains/screener/pagination.js";
import { parseScreenerFilters, parseSort } from "@/domains/screener/screenerFilterInput.js";
import type { ScreenerColumnRef, ScreenerFilter } from "@/domains/screener/screener.types.js";

const DEFAULT_RANKING_LIMIT = 10;
const MAX_RANKING_LIMIT = 50;

export const screenerRouter = Router();

// Guests can screen without an account — only saving a filter set as a named preset
// (POST /screener/presets) requires signing in. A valid token still personalizes the
// column resolution below (the caller's own default column preset); no token just falls
// through to the system default columns.
screenerRouter.use(optionalAuth);

function parseFilters(body: unknown): ScreenerFilter[] {
  return parseScreenerFilters((body as { filters?: unknown } | null)?.filters);
}

function parseOptionalColumnPresetId(body: unknown): string | undefined {
  const value = (body as { columnPresetId?: unknown } | null)?.columnPresetId;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new AppError('"columnPresetId" must be a UUID string', 400);
  }
  return parseUuidParam(value, "column preset");
}

screenerRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = req.user?.uid;
  const filters = parseFilters(req.body);
  const requestedColumnPresetId = parseOptionalColumnPresetId(req.body);
  const body = req.body as { page?: unknown; pageSize?: unknown; sortField?: unknown; sortOrder?: unknown } | null;
  const pagination = parsePagination(body?.page, body?.pageSize);
  const sort = parseSort(body?.sortField, body?.sortOrder);

  const { columnPresetId, columns } = await resolveScreenerColumns(firebaseUid, requestedColumnPresetId);
  const result = await runScreener(filters, columns, pagination, sort);
  res.json({ ...result, columnPresetId });
});

function parseSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError('"symbols" must be a non-empty array of strings', 400);
  }
  return raw.map((value, index) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new AppError(`symbols[${index}] must be a non-empty string`, 400);
    }
    return value;
  });
}

function parseColumnRefs(raw: unknown): ScreenerColumnRef[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError('"columns" must be a non-empty array', 400);
  }
  return raw.map((value, index) => {
    if (typeof value !== "object" || value === null || typeof (value as { field?: unknown }).field !== "string") {
      throw new AppError(`columns[${index}].field is required`, 400);
    }
    return { field: (value as { field: string }).field };
  });
}

screenerRouter.post("/values", async (req, res) => {
  const body = req.body as { symbols?: unknown; columns?: unknown } | null;
  const symbols = parseSymbols(body?.symbols);
  const columns = parseColumnRefs(body?.columns);

  const result = await runScreenerValues(symbols, columns);
  res.json(result);
});

function parseRankingDirection(raw: unknown): "asc" | "desc" {
  if (raw === undefined) {
    return "desc";
  }
  if (raw !== "asc" && raw !== "desc") {
    throw new AppError('"direction" must be "asc" or "desc"', 400);
  }
  return raw;
}

function parseRankingLimit(raw: unknown): number {
  if (raw === undefined) {
    return DEFAULT_RANKING_LIMIT;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError('"limit" must be a positive integer', 400);
  }
  if (value > MAX_RANKING_LIMIT) {
    throw new AppError(`"limit" must be at most ${MAX_RANKING_LIMIT}`, 400);
  }
  return value;
}

function parseRankingColumns(raw: unknown): ScreenerColumnRef[] {
  if (raw === undefined) {
    return [];
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new AppError('"columns" must be a comma-separated string of fields', 400);
  }
  return raw
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean)
    .map((field) => ({ field }));
}

screenerRouter.get("/ranking", async (req, res) => {
  const field = req.query.field;
  if (typeof field !== "string" || field.trim() === "") {
    throw new AppError('"field" query parameter is required', 400);
  }
  const direction = parseRankingDirection(req.query.direction);
  const limit = parseRankingLimit(req.query.limit);
  const columns = parseRankingColumns(req.query.columns);

  const result = await runRanking(field, direction, limit, columns);
  res.json(result);
});
