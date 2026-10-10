import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { UUID_PATTERN, parseUuidParam } from "@/shared/uuid.js";
import { parseBody, parseQuery, rejectRetiredParams } from "@/shared/validation.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { DEFAULT_PAGE_SIZE, paginationSchema } from "@/application/proxy/screener/pagination.js";
import { normalizeScreenerFilters, screenerFiltersArraySchema } from "@/application/proxy/screener/screenerFilterInput.js";
import {
  addPreset,
  editPreset,
  getPresetOrThrow,
  getPresets,
  removePreset,
  reorderPresetsForUser,
  type ScreenerPresetsDeps,
} from "@/application/screener/screenerPresets.service.js";
import { enforceQuota, type QuotaMiddlewareDeps } from "@/http/middleware/quota.middleware.js";
import { runPreset, type RunPresetDeps } from "@/application/proxy/screener/runPreset.js";

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
    order: z.enum(["asc", "desc"], { error: '"order" must be "asc" or "desc"' }).optional(),
  })
  .refine((data) => (data.sortField === undefined) === (data.order === undefined), {
    message: '"sortField" and "order" must be given together, or not at all',
    path: ["sortField"],
  });

/**
 * GET /screener/presets/:id/run 同時要用 preset 的儲存與代理層的 runPreset，所以這個路由需要的是
 * 兩者的聯集（RunPresetDeps 已經包含 ScreenerPresetsDeps）。
 */
type ScreenerPresetsRouterDeps = ScreenerPresetsDeps & RunPresetDeps & AuthMiddlewareDeps & QuotaMiddlewareDeps;

/**
 * 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。
 * 這裡順便修掉一個同性質的漏洞——額度檢查的 countPresets 以前是直接從 repository import 進來的，
 * http 層因此認得 Prisma；現在走 deps.screenerPresets.count，跟其他所有存取同一條路。
 */
export function createScreenerPresetsRouter(deps: ScreenerPresetsRouterDeps): Router {
  const screenerPresetsRouter = Router();
  screenerPresetsRouter.use(createRequireAuth(deps));

  screenerPresetsRouter.get("/", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const presets = await getPresets(firebaseUid, deps);
    res.json({ presets });
  });

  // Quota guards creation only — an over-quota user (e.g. one whose reverse trial just ended) keeps every
  // preset they already made; they simply can't add another. See billing/quota.middleware.ts.
  screenerPresetsRouter.post("/", enforceQuota("screenerPresets", (uid) => deps.screenerPresets.count(uid), deps), async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(createScreenerPresetSchema, req.body);

    const preset = await addPreset(firebaseUid, normalizeScreenerFilters(body.filters), body.sectorCodes, body.excludeSectorCodes, deps);
    res.status(201).json({ preset });
  });

  // Mounted before the "/:id" routes below — though since this is POST and the /:id routes are all
  // GET/PATCH/DELETE, there's no actual method collision either way.
  screenerPresetsRouter.post("/reorder", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(reorderScreenerPresetsSchema, req.body);
    const presets = await reorderPresetsForUser(firebaseUid, body.ids, deps);
    res.json({ presets });
  });

  screenerPresetsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    const preset = await getPresetOrThrow(firebaseUid, id, deps);
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
    }, deps);
    res.json({ preset });
  });

  screenerPresetsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    await removePreset(firebaseUid, id, deps);
    res.status(204).end();
  });

  screenerPresetsRouter.get("/:id/run", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    const query = parseQuery(runPresetQuerySchema, rejectRetiredParams(req.query, { sortOrder: "order" }));
    const pagination = { page: query.page ?? 1, pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE };
    const sort = query.sortField !== undefined ? { field: query.sortField, order: query.order! } : undefined;
    const result = await runPreset(firebaseUid, id, pagination, query.columnPresetId, sort, deps);
    res.json(result);
  });

  return screenerPresetsRouter;
}
