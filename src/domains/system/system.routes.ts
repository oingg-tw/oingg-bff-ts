import { Router } from "ultimate-express";
import { getHealthReport } from "./system.service.js";
import { startedAt } from "./system.state.js";

export const systemRouter = Router();

/**
 * @swagger
 * /system/health:
 *   get:
 *     summary: 健康檢查——實際測試每個相依資料庫連線，不是只回報 process 有沒有活著
 *     description: >
 *       對每個已註冊的 Neon pool（twse/tpex/mops/analysis...）以及這個服務自己的 Prisma app DB
 *       各發一次 `SELECT 1`（3 秒逾時），回報每個相依服務的連線狀態與延遲。只要有任何一個相依服務
 *       失敗，整體 status 就是 "degraded" 且 HTTP status 改回 503；全部正常則是 "ok" / 200。
 *       前端或 conductor 可以直接用 HTTP status code 判斷可用性，需要細節時再看 body 裡
 *       `dependencies` 個別項目。
 *     tags:
 *       - System
 *     responses:
 *       200:
 *         description: 全部相依服務都正常。
 *       503:
 *         description: 至少一個相依服務（某個 Neon pool 或 app DB）連線失敗。
 */
systemRouter.get("/health", async (_req, res) => {
  const report = await getHealthReport(startedAt);
  res.status(report.status === "ok" ? 200 : 503).json(report);
});
