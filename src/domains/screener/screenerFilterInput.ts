import { AppError } from "../../shared/errorHandler.js";
import type { ScreenerFilter } from "./screener.types.js";

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
