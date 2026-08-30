import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { parseUuidParam } from "../../shared/uuid.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { applyPresetTemplate, getPresetTemplateOrThrow, getPresetTemplates } from "./presetTemplates.service.js";

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

/**
 * @swagger
 * /screener/templates:
 *   get:
 *     summary: 列出所有人共用的篩選策略範本（大師策略／量化因子／台股籌碼面等）
 *     description: >
 *       不需要登入即可查看。每筆都有 `tier`（FREE/PAID，前端自行決定顯示/鎖定方式，這個服務本身不做
 *       付費驗證）跟 `status`（AVAILABLE 可直接套用；PENDING 表示目前生態系還沒有計算這個範本需要的
 *       指標，`pendingReason` 說明缺什麼，`filters` 會是空陣列）。
 *     tags:
 *       - Screener
 *     responses:
 *       200:
 *         description: 範本清單，依建議瀏覽順序排序。
 */
presetTemplatesRouter.get("/", async (_req, res) => {
  const templates = await getPresetTemplates();
  res.json({ templates });
});

/**
 * @swagger
 * /screener/templates/{id}:
 *   get:
 *     summary: 查詢單一範本的完整內容
 *     tags:
 *       - Screener
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: 範本內容。
 *       400:
 *         description: id 不是合法的 UUID。
 *       404:
 *         description: 找不到這個範本。
 */
presetTemplatesRouter.get("/:id", async (req, res) => {
  const id = parseId(req.params.id ?? "");
  const template = await getPresetTemplateOrThrow(id);
  res.json({ template });
});

/**
 * @swagger
 * /screener/templates/{id}/apply:
 *   post:
 *     summary: 把範本複製成一份自己的篩選組合（ScreenerPreset）
 *     description: >
 *       需要登入。新建立的 preset 會以範本名稱命名（撞名依序改成「範本名稱 2」「範本名稱 3」...）；
 *       之後編輯/刪除都跟一般 preset 一樣，不會再跟原範本有關聯。status 是 PENDING 的範本沒有真正的
 *       filters 可以複製，套用會回 409。
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       201:
 *         description: 新建立的篩選組合（跟 POST /screener/presets 回應格式相同）。
 *       400:
 *         description: id 不是合法的 UUID。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 找不到這個範本。
 *       409:
 *         description: 這個範本目前是 PENDING（還沒有真正可執行的 filters），無法套用。
 */
presetTemplatesRouter.post("/:id/apply", requireAuth, async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const preset = await applyPresetTemplate(firebaseUid, id);
  res.status(201).json({ preset });
});
