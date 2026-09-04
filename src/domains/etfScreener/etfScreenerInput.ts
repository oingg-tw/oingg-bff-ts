import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { parseBody } from "@/shared/validation.js";
import type { EtfScreenerSort } from "@/domains/etfScreener/etfScreener.client.js";
import type { EtfColumnRef, EtfScreenerFilter } from "@/domains/etfScreener/etfScreener.types.js";

/**
 * Each filter is either numeric (`min`/`max`/`exclude`) or categorical (`values` array) — `values`'s
 * presence is the discriminator. Which shape is actually correct for a given field is validated by
 * analysis-ts itself (no local catalog cache here to check against), so a numeric filter sent for a
 * categorical field (or vice versa) surfaces as their 400, not this schema's.
 */
export const etfFilterSchema = z.object({
  field: z.string({ error: "field is required" }).trim().min(1, "field is required"),
  min: z.number({ error: "min must be a number or null" }).nullish(),
  max: z.number({ error: "max must be a number or null" }).nullish(),
  exclude: z.boolean({ error: "exclude must be a boolean" }).optional(),
  values: z
    .array(z.string({ error: "values must be an array of strings" }), { error: "values must be an array of strings" })
    .optional(),
});

export const etfScreenerFiltersArraySchema = z.array(etfFilterSchema);

export function toEtfScreenerFilter(f: z.infer<typeof etfFilterSchema>): EtfScreenerFilter {
  if (f.values !== undefined) {
    return { field: f.field, values: f.values };
  }
  return { field: f.field, min: f.min ?? null, max: f.max ?? null, exclude: f.exclude ?? false };
}

/** Parses a raw `filters` array from a request body. Same schema also drives the OpenAPI docs. */
export function parseEtfScreenerFilters(filtersRaw: unknown, path = "filters"): EtfScreenerFilter[] {
  if (filtersRaw === undefined) {
    return [];
  }
  if (!Array.isArray(filtersRaw)) {
    throw new AppError(`"${path}" must be an array`, 400);
  }
  return parseBody(etfScreenerFiltersArraySchema, filtersRaw).map(toEtfScreenerFilter);
}

export const etfColumnSchema = z.object({
  field: z.string({ error: "field is required" }).trim().min(1, "field is required"),
});
export const etfColumnsArraySchema = z.array(etfColumnSchema);

export function parseEtfColumns(columnsRaw: unknown, path = "columns"): EtfColumnRef[] {
  if (columnsRaw === undefined) {
    return [];
  }
  if (!Array.isArray(columnsRaw)) {
    throw new AppError(`"${path}" must be an array`, 400);
  }
  return parseBody(etfColumnsArraySchema, columnsRaw);
}

const etfSortValueSchema = z.object({
  sortField: z
    .string({ error: '"sortField" must be a non-empty string' })
    .trim()
    .min(1, '"sortField" must be a non-empty string'),
  sortOrder: z.enum(["asc", "desc"], { error: '"sortOrder" must be "asc" or "desc"' }),
});

/** analysis-ts requires both or neither, same as the stock screener's sortField/sortOrder — fail fast here to avoid the round trip. */
export function parseEtfSort(sortFieldRaw: unknown, sortOrderRaw: unknown): EtfScreenerSort | undefined {
  if (sortFieldRaw === undefined && sortOrderRaw === undefined) {
    return undefined;
  }
  if (sortFieldRaw === undefined || sortOrderRaw === undefined) {
    throw new AppError('"sortField" and "sortOrder" must be given together, or not at all', 400);
  }
  const parsed = parseBody(etfSortValueSchema, { sortField: sortFieldRaw, sortOrder: sortOrderRaw });
  return { field: parsed.sortField, order: parsed.sortOrder };
}

export const DEFAULT_ETF_SCREENER_PAGE_SIZE = 50;
export const MAX_ETF_SCREENER_PAGE_SIZE = 200;

function positiveIntSchema(field: string) {
  return z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : v),
    z
      .coerce.number({ error: `"${field}" must be a positive integer` })
      .refine((n) => Number.isInteger(n) && n > 0, { message: `"${field}" must be a positive integer` })
      .optional(),
  );
}

export const etfScreenerPaginationSchema = z.object({
  page: positiveIntSchema("page"),
  pageSize: positiveIntSchema("pageSize").refine((n) => n === undefined || n <= MAX_ETF_SCREENER_PAGE_SIZE, {
    message: `"pageSize" must be at most ${MAX_ETF_SCREENER_PAGE_SIZE}`,
  }),
});

export interface EtfScreenerPagination {
  page: number;
  pageSize: number;
}

export function parseEtfScreenerPagination(rawPage: unknown, rawPageSize: unknown): EtfScreenerPagination {
  const parsed = parseBody(etfScreenerPaginationSchema, { page: rawPage, pageSize: rawPageSize });
  return { page: parsed.page ?? 1, pageSize: parsed.pageSize ?? DEFAULT_ETF_SCREENER_PAGE_SIZE };
}
