import { Router } from "ultimate-express";
import { AppError } from "@/shared/errorHandler.js";
import { requireAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import {
  applyColumnPresetTemplate,
  getColumnPresetTemplateOrThrow,
  getColumnPresetTemplates,
} from "@/domains/columnPresetTemplates/columnPresetTemplates.service.js";

export const columnPresetTemplatesRouter = Router();

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

columnPresetTemplatesRouter.get("/", async (_req, res) => {
  const templates = await getColumnPresetTemplates();
  res.json({ templates });
});

columnPresetTemplatesRouter.get("/:key", async (req, res) => {
  const template = await getColumnPresetTemplateOrThrow(req.params.key ?? "");
  res.json({ template });
});

columnPresetTemplatesRouter.post("/:key/apply", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const preset = await applyColumnPresetTemplate(firebaseUid, req.params.key ?? "");
  res.status(201).json({ preset });
});
