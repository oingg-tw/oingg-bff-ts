import { Router } from "ultimate-express";
import { AppError } from "@/domain/appError.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import {
  applyPresetTemplate,
  getPresetTemplateOrThrow,
  getPresetTemplates,
  type PresetTemplatesDeps,
} from "@/application/presetTemplates/presetTemplates.service.js";

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): string {
  return parseUuidParam(raw, "preset template");
}

/** 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。 */
export function createPresetTemplatesRouter(deps: PresetTemplatesDeps & AuthMiddlewareDeps): Router {
  const presetTemplatesRouter = Router();

  presetTemplatesRouter.get("/", async (_req, res) => {
    const templates = await getPresetTemplates(deps);
    res.json({ templates });
  });

  presetTemplatesRouter.get("/:id", async (req, res) => {
    const id = parseId(req.params.id ?? "");
    const template = await getPresetTemplateOrThrow(id, deps);
    res.json({ template });
  });

  presetTemplatesRouter.post("/:id/apply", createRequireAuth(deps), async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    const preset = await applyPresetTemplate(firebaseUid, id, deps);
    res.status(201).json({ preset });
  });

  return presetTemplatesRouter;
}
