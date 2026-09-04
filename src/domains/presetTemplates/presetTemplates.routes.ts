import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { requireAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import { applyPresetTemplate, getPresetTemplateOrThrow, getPresetTemplates } from "@/domains/presetTemplates/presetTemplates.service.js";

export const presetTemplatesRouter = Router();

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): string {
  return parseUuidParam(raw, "preset template");
}

presetTemplatesRouter.get("/", async (_req, res) => {
  const templates = await getPresetTemplates();
  res.json({ templates });
});

presetTemplatesRouter.get("/:id", async (req, res) => {
  const id = parseId(req.params.id ?? "");
  const template = await getPresetTemplateOrThrow(id);
  res.json({ template });
});

presetTemplatesRouter.post("/:id/apply", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const preset = await applyPresetTemplate(firebaseUid, id);
  res.status(201).json({ preset });
});
