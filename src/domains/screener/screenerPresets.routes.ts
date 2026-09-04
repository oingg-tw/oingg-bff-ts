import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { requireAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import { parsePagination } from "@/domains/screener/pagination.js";
import { parseScreenerFilters, parseSort } from "@/domains/screener/screenerFilterInput.js";
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

function parseOptionalName(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError('"name" must be a non-empty string', 400);
  }
  return value.trim();
}

screenerPresetsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const presets = await getPresets(firebaseUid);
  res.json({ presets });
});

screenerPresetsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { filters?: unknown } | null;
  const filters = parseScreenerFilters(body?.filters);

  const preset = await addPreset(firebaseUid, filters);
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
  const body = req.body as { name?: unknown; filters?: unknown } | null;

  const preset = await editPreset(firebaseUid, id, {
    name: parseOptionalName(body?.name),
    filters: body?.filters === undefined ? undefined : parseScreenerFilters(body.filters),
  });
  res.json({ preset });
});

screenerPresetsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removePreset(firebaseUid, id);
  res.status(204).end();
});

function parseOptionalColumnPresetIdQuery(raw: unknown): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new AppError(`Invalid columnPresetId "${String(raw)}"`, 400);
  }
  return parseUuidParam(raw, "column preset");
}

screenerPresetsRouter.get("/:id/run", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const columnPresetId = parseOptionalColumnPresetIdQuery(req.query.columnPresetId);
  const pagination = parsePagination(req.query.page, req.query.pageSize);
  const sort = parseSort(req.query.sortField, req.query.sortOrder);
  const result = await runPreset(firebaseUid, id, pagination, columnPresetId, sort);
  res.json(result);
});
