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

/**
 * @swagger
 * /screener/column-preset-templates:
 *   get:
 *     summary: 列出所有人共用的欄位組合範本（存股領息／價值投資／獲利品質拆解等）
 *     description: >
 *       不需要登入即可查看。由 oingg-analysis-ts 統一維護內容，開機時同步進本服務自己的資料庫
 *       （跟 GET /filters 的 filter catalog 同步機制一樣）。其中恰好一組會標記 `isDefault: true`
 *       （目前是「總覽」），這組也是 POST /screener 在沒有指定/沒有使用者自訂預設欄位時的實際
 *       fallback columns（見 columnPresets.service.ts 的 resolveScreenerColumns）。
 *     tags:
 *       - Screener
 *     responses:
 *       200:
 *         description: 範本清單，依建議瀏覽順序排序。
 */
columnPresetTemplatesRouter.get("/", async (_req, res) => {
  const templates = await getColumnPresetTemplates();
  res.json({ templates });
});

/**
 * @swagger
 * /screener/column-preset-templates/{key}:
 *   get:
 *     summary: 查詢單一欄位組合範本的完整內容
 *     tags:
 *       - Screener
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 範本內容。
 *       404:
 *         description: 找不到這個範本。
 */
columnPresetTemplatesRouter.get("/:key", async (req, res) => {
  const template = await getColumnPresetTemplateOrThrow(req.params.key ?? "");
  res.json({ template });
});

/**
 * @swagger
 * /screener/column-preset-templates/{key}/apply:
 *   post:
 *     summary: 把欄位組合範本複製成一份自己的欄位組合（ColumnPreset）
 *     description: >
 *       需要登入。新建立的 preset 會以範本名稱命名（撞名依序改成「範本名稱 2」「範本名稱 3」...）；
 *       之後編輯/刪除都跟一般 column preset 一樣，不會再跟原範本有關聯。
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: 新建立的欄位組合（跟 POST /screener/column-presets 回應格式相同）。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 找不到這個範本。
 */
columnPresetTemplatesRouter.post("/:key/apply", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const preset = await applyColumnPresetTemplate(firebaseUid, req.params.key ?? "");
  res.status(201).json({ preset });
});
