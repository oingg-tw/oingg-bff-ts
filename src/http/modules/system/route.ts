import { Router } from "ultimate-express";
import { getHealthReport, type SystemDeps } from "@/application/system/system.service.js";
import { startedAt } from "@/application/system/system.state.js";

/** 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。 */
export function createSystemRouter(deps: SystemDeps): Router {
  const systemRouter = Router();

  systemRouter.get("/health", async (_req, res) => {
    const report = await getHealthReport(startedAt, deps);
    res.status(report.status === "ok" ? 200 : 503).json(report);
  });

  return systemRouter;
}
