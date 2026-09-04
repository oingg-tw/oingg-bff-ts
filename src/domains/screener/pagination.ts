import { z } from "zod";
import { parseBody } from "@/shared/validation.js";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface Pagination {
  page: number;
  pageSize: number;
}

function positiveIntSchema(field: string) {
  return z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : v),
    z
      .coerce.number({ error: `"${field}" must be a positive integer` })
      .refine((n) => Number.isInteger(n) && n > 0, { message: `"${field}" must be a positive integer` })
      .optional(),
  );
}

/** Shared by POST /screener (body fields) and GET /screener/presets/:id/run (query params) — both pass
 * raw, unvalidated values through here. Same schema also drives their OpenAPI docs. */
export const paginationSchema = z.object({
  page: positiveIntSchema("page"),
  pageSize: positiveIntSchema("pageSize").refine((n) => n === undefined || n <= MAX_PAGE_SIZE, {
    message: `"pageSize" must be at most ${MAX_PAGE_SIZE}`,
  }),
});

export function parsePagination(rawPage: unknown, rawPageSize: unknown): Pagination {
  const parsed = parseBody(paginationSchema, { page: rawPage, pageSize: rawPageSize });
  return { page: parsed.page ?? 1, pageSize: parsed.pageSize ?? DEFAULT_PAGE_SIZE };
}
