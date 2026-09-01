import { AppError } from "@/shared/errorHandler.js";
import type { ScreenerSort } from "@/domains/screener/analysisScreenerClient.js";
import type { ScreenerFilter } from "@/domains/screener/screener.types.js";

function parseNullableNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number") {
    throw new AppError(`${path} must be a number or null`, 400);
  }
  return value;
}

/** Parses/validates a raw `filters` array from a request body. Shared by POST /screener and the preset CRUD routes. */
export function parseScreenerFilters(filtersRaw: unknown, path = "filters"): ScreenerFilter[] {
  if (!Array.isArray(filtersRaw)) {
    throw new AppError(`"${path}" must be an array`, 400);
  }

  return filtersRaw.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new AppError(`${path}[${index}] must be an object`, 400);
    }
    const { field, min, max, exclude } = raw as Record<string, unknown>;

    if (typeof field !== "string" || field.trim() === "") {
      throw new AppError(`${path}[${index}].field is required`, 400);
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
  if (typeof sortFieldRaw !== "string" || sortFieldRaw.trim() === "") {
    throw new AppError('"sortField" must be a non-empty string', 400);
  }
  if (sortOrderRaw !== "asc" && sortOrderRaw !== "desc") {
    throw new AppError('"sortOrder" must be "asc" or "desc"', 400);
  }
  return { field: sortFieldRaw, order: sortOrderRaw };
}
