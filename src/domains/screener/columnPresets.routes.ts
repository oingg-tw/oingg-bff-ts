import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import { parseUuidParam } from "@/shared/uuid.js";
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

function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError('"name" is required', 400);
  }
  return value.trim();
}

function parseColumnFields(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new AppError('"columns" must be an array', 400);
  }
  return raw.map((item, index) => {
    const field = (item as { field?: unknown } | null)?.field;
    if (typeof field !== "string" || field.trim() === "") {
      throw new AppError(`columns[${index}].field is required`, 400);
    }
    return field;
  });
}

function parseIsDefault(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new AppError('"isDefault" must be a boolean', 400);
  }
  return value;
}

columnPresetsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const columnPresets = await getColumnPresets(firebaseUid);
  res.json({ columnPresets });
});

columnPresetsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { name?: unknown; columns?: unknown; isDefault?: unknown } | null;
  const name = parseName(body?.name);
  const columns = parseColumnFields(body?.columns);
  const isDefault = parseIsDefault(body?.isDefault) ?? false;

  const columnPreset = await addColumnPreset(firebaseUid, name, columns, isDefault);
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
  const body = req.body as { name?: unknown; columns?: unknown; isDefault?: unknown } | null;

  const columnPreset = await editColumnPreset(firebaseUid, id, {
    name: body?.name === undefined ? undefined : parseName(body.name),
    columns: body?.columns === undefined ? undefined : parseColumnFields(body.columns),
    isDefault: parseIsDefault(body?.isDefault),
  });
  res.json({ columnPreset });
});

columnPresetsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removeColumnPreset(firebaseUid, id);
  res.status(204).end();
});
