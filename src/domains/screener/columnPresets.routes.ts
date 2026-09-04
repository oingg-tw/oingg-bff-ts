import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { requireAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import {
  addColumnPreset,
  editColumnPreset,
  getColumnPresetOrThrow,
  getColumnPresets,
  removeColumnPreset,
} from "@/domains/screener/columnPresets.service.js";

export const columnPresetsRouter = Router();

columnPresetsRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): string {
  return parseUuidParam(raw, "column preset");
}

const columnFieldSchema = z.object({ field: z.string().trim().min(1) });

export const createColumnPresetSchema = z.object({
  name: z.string().trim().min(1, '"name" is required'),
  columns: z.array(columnFieldSchema),
  isDefault: z.boolean().optional(),
});

export const updateColumnPresetSchema = z.object({
  name: z.string().trim().min(1).optional(),
  columns: z.array(columnFieldSchema).optional(),
  isDefault: z.boolean().optional(),
});

columnPresetsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const columnPresets = await getColumnPresets(firebaseUid);
  res.json({ columnPresets });
});

columnPresetsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(createColumnPresetSchema, req.body);

  const columnPreset = await addColumnPreset(
    firebaseUid,
    body.name,
    body.columns.map((c) => c.field),
    body.isDefault ?? false,
  );
  res.status(201).json({ columnPreset });
});

columnPresetsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const columnPreset = await getColumnPresetOrThrow(firebaseUid, id);
  res.json({ columnPreset });
});

columnPresetsRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const body = parseBody(updateColumnPresetSchema, req.body ?? {});

  const columnPreset = await editColumnPreset(firebaseUid, id, {
    name: body.name,
    columns: body.columns?.map((c) => c.field),
    isDefault: body.isDefault,
  });
  res.json({ columnPreset });
});

columnPresetsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removeColumnPreset(firebaseUid, id);
  res.status(204).end();
});
