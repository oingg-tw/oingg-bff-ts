import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { parseBody } from "@/shared/validation.js";
import type { ScreenerSort } from "@/domains/screener/analysisScreenerClient.js";
import type { ScreenerFilter } from "@/domains/screener/screener.types.js";

/** One filter condition — the shared shape for POST /screener's body and the preset CRUD routes'. */
export const screenerFilterSchema = z.object({
  field: z.string().trim().min(1, "field is required"),
  min: z.number().nullish(),
  max: z.number().nullish(),
  exclude: z.boolean().optional(),
});

export const screenerFiltersArraySchema = z.array(screenerFilterSchema);

/** Normalizes a schema-parsed filters array to ScreenerFilter[] (min/max default null, exclude default false). */
export function normalizeScreenerFilters(filters: z.infer<typeof screenerFiltersArraySchema>): ScreenerFilter[] {
  return filters.map((f) => ({ field: f.field, min: f.min ?? null, max: f.max ?? null, exclude: f.exclude ?? false }));
}

/**
 * Parses/validates a raw `filters` array from a request body. Shared by POST /screener and the preset
 * CRUD routes — same schema also drives their OpenAPI docs (see screenerFilterSchema above).
 */
export function parseScreenerFilters(filtersRaw: unknown, path = "filters"): ScreenerFilter[] {
  if (!Array.isArray(filtersRaw)) {
    throw new AppError(`"${path}" must be an array`, 400);
  }
  return normalizeScreenerFilters(parseBody(screenerFiltersArraySchema, filtersRaw));
}

const sortValueSchema = z.object({
  sortField: z
    .string({ error: '"sortField" must be a non-empty string' })
    .trim()
    .min(1, '"sortField" must be a non-empty string'),
  sortOrder: z.enum(["asc", "desc"], { error: '"sortOrder" must be "asc" or "desc"' }),
});

/**
 * Parses/validates `sortField`/`sortOrder` from a request body. Shared by POST /screener and
 * GET /screener/presets/:id/run — analysis-ts requires both or neither (giving just one is a 400 on
 * their side too, but failing fast here avoids the round trip). Whether `sortField` is actually a valid
 * "symbol" or one of this request's own columns is checked in screener.service.ts's runScreener, since
 * that needs the resolved catalog fields this parser doesn't have access to.
 */
export function parseSort(sortFieldRaw: unknown, sortOrderRaw: unknown): ScreenerSort | undefined {
  if (sortFieldRaw === undefined && sortOrderRaw === undefined) {
    return undefined;
  }
  if (sortFieldRaw === undefined || sortOrderRaw === undefined) {
    throw new AppError('"sortField" and "sortOrder" must be given together, or not at all', 400);
  }
  const parsed = parseBody(sortValueSchema, { sortField: sortFieldRaw, sortOrder: sortOrderRaw });
  return { field: parsed.sortField, order: parsed.sortOrder };
}
