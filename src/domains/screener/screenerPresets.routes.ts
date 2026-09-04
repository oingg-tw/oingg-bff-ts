import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { UUID_PATTERN, parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { requireAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import { DEFAULT_PAGE_SIZE, paginationSchema } from "@/domains/screener/pagination.js";
import { normalizeScreenerFilters, screenerFiltersArraySchema } from "@/domains/screener/screenerFilterInput.js";
import {
  addPreset,
  editPreset,
  getPresetOrThrow,
  getPresets,
  removePreset,
  runPreset,
} from "@/domains/screener/screenerPresets.service.js";

export const screenerPresetsRouter = Router();

screenerPresetsRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): string {
  return parseUuidParam(raw, "preset");
}

export const createScreenerPresetSchema = z.object({
  filters: screenerFiltersArraySchema,
});

export const updateScreenerPresetSchema = z.object({
  name: z
    .string({ error: '"name" must be a non-empty string' })
    .trim()
    .min(1, '"name" must be a non-empty string')
    .optional(),
  filters: screenerFiltersArraySchema.optional(),
});

screenerPresetsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const presets = await getPresets(firebaseUid);
  res.json({ presets });
});

screenerPresetsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(createScreenerPresetSchema, req.body);

  const preset = await addPreset(firebaseUid, normalizeScreenerFilters(body.filters));
  res.status(201).json({ preset });
});

screenerPresetsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const preset = await getPresetOrThrow(firebaseUid, id);
  res.json({ preset });
});

screenerPresetsRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const body = parseBody(updateScreenerPresetSchema, req.body ?? {});

  const preset = await editPreset(firebaseUid, id, {
    name: body.name,
    filters: body.filters === undefined ? undefined : normalizeScreenerFilters(body.filters),
  });
  res.json({ preset });
});

screenerPresetsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removePreset(firebaseUid, id);
  res.status(204).end();
});

export const runPresetQuerySchema = z
  .object({
    columnPresetId: z
      .string({ error: '"columnPresetId" must be a UUID string' })
      .regex(UUID_PATTERN, { error: '"columnPresetId" must be a valid UUID' })
      .optional(),
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

screenerPresetsRouter.get("/:id/run", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const query = parseBody(runPresetQuerySchema, req.query);
  const pagination = { page: query.page ?? 1, pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE };
  const sort = query.sortField !== undefined ? { field: query.sortField, order: query.sortOrder! } : undefined;
  const result = await runPreset(firebaseUid, id, pagination, query.columnPresetId, sort);
  res.json(result);
});
