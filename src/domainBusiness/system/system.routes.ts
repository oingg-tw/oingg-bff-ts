import { Router } from "ultimate-express";
import { getHealthReport } from "@/domainBusiness/system/system.service.js";
import { startedAt } from "@/domainBusiness/system/system.state.js";

export const systemRouter = Router();

systemRouter.get("/health", async (_req, res) => {
  const report = await getHealthReport(startedAt);
  res.status(report.status === "ok" ? 200 : 503).json(report);
});
