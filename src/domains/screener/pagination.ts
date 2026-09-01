import { AppError } from "@/shared/errorHandler.js";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface Pagination {
  page: number;
  pageSize: number;
}

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

/** Shared by POST /screener (body fields) and GET /screener/presets/:id/run (query params) — both pass raw, unvalidated values through here. */
export function parsePagination(rawPage: unknown, rawPageSize: unknown): Pagination {
  const page = parsePositiveInt(rawPage, 1, "page");
  const pageSize = parsePositiveInt(rawPageSize, DEFAULT_PAGE_SIZE, "pageSize");
  if (pageSize > MAX_PAGE_SIZE) {
    throw new AppError(`"pageSize" must be at most ${MAX_PAGE_SIZE}`, 400);
  }
  return { page, pageSize };
}
