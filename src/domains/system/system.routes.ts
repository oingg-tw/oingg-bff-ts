import { Router } from "ultimate-express";
import { listNeonPoolNames } from "../../adapters/neon/index.js";

export const systemRouter = Router();

/**
 * @swagger
 * /system/health:
 *   get:
 *     summary: 健康檢查
 *     description: 列出目前已連線的 Neon pool 名稱（不含 Prisma 管理的 app DB）。
 *     tags:
 *       - System
 *     responses:
 *       200:
 *         description: 伺服器與已連線 Neon pool 清單。
 */
systemRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    neonPools: listNeonPoolNames(),
  });
});
