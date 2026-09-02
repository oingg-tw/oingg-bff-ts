import { AppError } from "@/shared/errorHandler.js";
import type { EtfScreenerSort } from "@/domains/etfScreener/etfScreener.client.js";
import type { EtfColumnRef, EtfScreenerFilter } from "@/domains/etfScreener/etfScreener.types.js";

function parseNullableNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number") {
    throw new AppError(`${path} must be a number or null`, 400);
  }
  return value;
}

/**
 * Parses a raw `filters` array from a request body. Each filter is either numeric (`min`/`max`/
 * `exclude`) or categorical (`values` array) — `values`'s presence is the discriminator. Which shape is
 * actually correct for a given field is validated by analysis-ts itself (no local catalog cache here to
 * check against), so a numeric filter sent for a categorical field (or vice versa) surfaces as their 400,
 * not this parser's.
 */
export function parseEtfScreenerFilters(filtersRaw: unknown, path = "filters"): EtfScreenerFilter[] {
  if (filtersRaw === undefined) {
    return [];
  }
  if (!Array.isArray(filtersRaw)) {
    throw new AppError(`"${path}" must be an array`, 400);
  }

  return filtersRaw.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new AppError(`${path}[${index}] must be an object`, 400);
    }
    const { field, min, max, exclude, values } = raw as Record<string, unknown>;

    if (typeof field !== "string" || field.trim() === "") {
      throw new AppError(`${path}[${index}].field is required`, 400);
    }

    if (values !== undefined) {
      if (!Array.isArray(values) || !values.every((v) => typeof v === "string")) {
        throw new AppError(`${path}[${index}].values must be an array of strings`, 400);
      }
      return { field, values };
    }

    if (exclude !== undefined && typeof exclude !== "boolean") {
      throw new AppError(`${path}[${index}].exclude must be a boolean`, 400);
    }
    return {
      field,
      min: parseNullableNumber(min, `${path}[${index}].min`),
      max: parseNullableNumber(max, `${path}[${index}].max`),
      exclude: exclude ?? false,
    };
  });
}

export function parseEtfColumns(columnsRaw: unknown, path = "columns"): EtfColumnRef[] {
  if (columnsRaw === undefined) {
    return [];
  }
  if (!Array.isArray(columnsRaw)) {
    throw new AppError(`"${path}" must be an array`, 400);
  }
  return columnsRaw.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new AppError(`${path}[${index}] must be an object`, 400);
    }
    const { field } = raw as Record<string, unknown>;
    if (typeof field !== "string" || field.trim() === "") {
      throw new AppError(`${path}[${index}].field is required`, 400);
    }
    return { field };
  });
}

/** analysis-ts requires both or neither, same as the stock screener's sortField/sortOrder — fail fast here to avoid the round trip. */
export function parseEtfSort(sortFieldRaw: unknown, sortOrderRaw: unknown): EtfScreenerSort | undefined {
  if (sortFieldRaw === undefined && sortOrderRaw === undefined) {
    return undefined;
  }
  if (sortFieldRaw === undefined || sortOrderRaw === undefined) {
    throw new AppError('"sortField" and "sortOrder" must be given together, or not at all', 400);
  }
  if (typeof sortFieldRaw !== "string" || sortFieldRaw.trim() === "") {
    throw new AppError('"sortField" must be a non-empty string', 400);
  }
  if (sortOrderRaw !== "asc" && sortOrderRaw !== "desc") {
    throw new AppError('"sortOrder" must be "asc" or "desc"', 400);
  }
  return { field: sortFieldRaw, order: sortOrderRaw };
}

export const DEFAULT_ETF_SCREENER_PAGE_SIZE = 50;
export const MAX_ETF_SCREENER_PAGE_SIZE = 200;

function parsePositiveInt(raw: unknown, defaultValue: number, field: string): number {
  if (raw === undefined || raw === null || raw === "") {
    return defaultValue;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(`"${field}" must be a positive integer`, 400);
  }
  return value;
}

export interface EtfScreenerPagination {
  page: number;
  pageSize: number;
}

export function parseEtfScreenerPagination(rawPage: unknown, rawPageSize: unknown): EtfScreenerPagination {
  const page = parsePositiveInt(rawPage, 1, "page");
  const pageSize = parsePositiveInt(rawPageSize, DEFAULT_ETF_SCREENER_PAGE_SIZE, "pageSize");
  if (pageSize > MAX_ETF_SCREENER_PAGE_SIZE) {
    throw new AppError(`"pageSize" must be at most ${MAX_ETF_SCREENER_PAGE_SIZE}`, 400);
  }
  return { page, pageSize };
}
