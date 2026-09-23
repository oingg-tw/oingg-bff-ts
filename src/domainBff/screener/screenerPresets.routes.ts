import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { UUID_PATTERN, parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { requireAuth } from "@/domainBusiness/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domainBusiness/auth/auth.types.js";
import { DEFAULT_PAGE_SIZE, paginationSchema } from "@/domainBff/screener/pagination.js";
import { normalizeScreenerFilters, screenerFiltersArraySchema } from "@/domainBff/screener/screenerFilterInput.js";
import {
  addPreset,
  editPreset,
  getPresetOrThrow,
  getPresets,
  removePreset,
  reorderPresetsForUser,
} from "@/domainBusiness/screener/screenerPresets.service.js";
import { countPresets } from "@/domainBusiness/screener/screenerPresets.repository.js";
import { enforceQuota } from "@/domainBusiness/billing/quota.middleware.js";
import { runPreset } from "@/domainBff/screener/runPreset.js";

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

const sectorCodesSchema = z.array(z.string().trim().min(1)).optional();

function notBothSectorCodesGiven(data: { sectorCodes?: string[]; excludeSectorCodes?: string[] }): boolean {
  return !(data.sectorCodes && data.sectorCodes.length > 0 && data.excludeSectorCodes && data.excludeSectorCodes.length > 0);
}

const MUTUALLY_EXCLUSIVE_SECTOR_CODES_ISSUE = {
  message: '"sectorCodes" and "excludeSectorCodes" can\'t both be given — pick one',
  path: ["excludeSectorCodes"] as string[],
};

export const createScreenerPresetSchema = z
  .object({
    filters: screenerFiltersArraySchema,
    sectorCodes: sectorCodesSchema,
    // Symmetric with sectorCodes ("every sector except these"), added 2026-09-20 alongside POST /screener's
    // own excludeSectorCodes — see screener.routes.ts. Mutually exclusive with sectorCodes.
    excludeSectorCodes: sectorCodesSchema,
  })
  .refine(notBothSectorCodesGiven, MUTUALLY_EXCLUSIVE_SECTOR_CODES_ISSUE);

export const reorderScreenerPresetsSchema = z.object({
  ids: z.array(z.string().regex(UUID_PATTERN)).min(1, '"ids" must be a non-empty array of UUIDs'),
});

export const updateScreenerPresetSchema = z
  .object({
    name: z
      .string({ error: '"name" must be a non-empty string' })
      .trim()
      .min(1, '"name" must be a non-empty string')
      .optional(),
    filters: screenerFiltersArraySchema.optional(),
    sectorCodes: sectorCodesSchema,
    excludeSectorCodes: sectorCodesSchema,
  })
  .refine(notBothSectorCodesGiven, MUTUALLY_EXCLUSIVE_SECTOR_CODES_ISSUE);

screenerPresetsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const presets = await getPresets(firebaseUid);
  res.json({ presets });
});

// Quota guards creation only — an over-quota user (e.g. one whose reverse trial just ended) keeps every
// preset they already made; they simply can't add another. See billing/quota.middleware.ts.
screenerPresetsRouter.post("/", enforceQuota("screenerPresets", countPresets), async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(createScreenerPresetSchema, req.body);

  const preset = await addPreset(firebaseUid, normalizeScreenerFilters(body.filters), body.sectorCodes, body.excludeSectorCodes);
  res.status(201).json({ preset });
});

// Mounted before the "/:id" routes below — though since this is POST and the /:id routes are all
// GET/PATCH/DELETE, there's no actual method collision either way.
screenerPresetsRouter.post("/reorder", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(reorderScreenerPresetsSchema, req.body);
  const presets = await reorderPresetsForUser(firebaseUid, body.ids);
  res.json({ presets });
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
    sectorCodes: body.sectorCodes,
    excludeSectorCodes: body.excludeSectorCodes,
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
