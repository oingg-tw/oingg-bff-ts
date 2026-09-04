import { Router } from "ultimate-express";
import { getHealthReport } from "@/domains/system/system.service.js";
import { startedAt } from "@/domains/system/system.state.js";

export const systemRouter = Router();

systemRouter.get("/health", async (_req, res) => {
  const report = await getHealthReport(startedAt);
  res.status(report.status === "ok" ? 200 : 503).json(report);
});
