import { Router } from "ultimate-express";
import { AppError } from "@/domain/appError.js";
import { requireAuth } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/application/auth/auth.types.js";
import {
  applyColumnPresetTemplate,
  getColumnPresetTemplateOrThrow,
  getColumnPresetTemplates,
  type ColumnPresetTemplatesDeps,
} from "@/application/columnPresetTemplates/columnPresetTemplates.service.js";

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

/** 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。 */
export function createColumnPresetTemplatesRouter(deps: ColumnPresetTemplatesDeps): Router {
  const columnPresetTemplatesRouter = Router();

  columnPresetTemplatesRouter.get("/", async (_req, res) => {
    const templates = await getColumnPresetTemplates(deps);
    res.json({ templates });
  });

  columnPresetTemplatesRouter.get("/:key", async (req, res) => {
    const template = await getColumnPresetTemplateOrThrow(req.params.key ?? "", deps);
    res.json({ template });
  });

  columnPresetTemplatesRouter.post("/:key/apply", requireAuth, async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const preset = await applyColumnPresetTemplate(firebaseUid, req.params.key ?? "", deps);
    res.status(201).json({ preset });
  });

  return columnPresetTemplatesRouter;
}
