import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import {
  addColumnPreset,
  editColumnPreset,
  getColumnPresetOrThrow,
  getColumnPresets,
  removeColumnPreset,
} from "./columnPresets.service.js";

export const columnPresetsRouter = Router();

columnPresetsRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(`Invalid column preset id "${raw}"`, 400);
  }
  return id;
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError('"name" is required', 400);
  }
  return value.trim();
}

function parseColumnFields(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new AppError('"columns" must be an array', 400);
  }
  return raw.map((item, index) => {
    const field = (item as { field?: unknown } | null)?.field;
    if (typeof field !== "string" || field.trim() === "") {
      throw new AppError(`columns[${index}].field is required`, 400);
    }
    return field;
  });
}

function parseIsDefault(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new AppError('"isDefault" must be a boolean', 400);
  }
  return value;
}

/**
 * @swagger
 * /screener/column-presets:
 *   get:
 *     summary: 列出目前使用者儲存的顯示欄位組合
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 欄位組合清單，依建立時間新到舊排序。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
columnPresetsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const columnPresets = await getColumnPresets(firebaseUid);
  res.json({ columnPresets });
});

/**
 * @swagger
 * /screener/column-presets:
 *   post:
 *     summary: 儲存一組新的顯示欄位組合
 *     description: >
 *       field 格式跟 filters 一樣是 "<metricKey>.<fieldKey>"，另外多支援一個特殊欄位 "stock.price"
 *       （股價，來自 twse/tpex，不是 filterCatalog 的一部分）。isDefault=true 時會自動取消同一使用者
 *       底下其他組合的預設狀態——同時間最多只有一組是預設。columns 可以是空陣列。
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - columns
 *             properties:
 *               name:
 *                 type: string
 *                 example: "常用欄位"
 *               isDefault:
 *                 type: boolean
 *                 default: false
 *               columns:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - field
 *                   properties:
 *                     field:
 *                       type: string
 *                       example: "marketRatios.peRatio"
 *     responses:
 *       201:
 *         description: 新增成功的欄位組合。
 *       400:
 *         description: 缺少 name/columns，或有 field 既不是 filterCatalog 欄位也不是特殊欄位。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       409:
 *         description: 已經有同名的欄位組合。
 */
columnPresetsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { name?: unknown; columns?: unknown; isDefault?: unknown } | null;
  const name = parseName(body?.name);
  const columns = parseColumnFields(body?.columns);
  const isDefault = parseIsDefault(body?.isDefault) ?? false;

  const columnPreset = await addColumnPreset(firebaseUid, name, columns, isDefault);
  res.status(201).json({ columnPreset });
});

/**
 * @swagger
 * /screener/column-presets/{id}:
 *   get:
 *     summary: 查詢單一顯示欄位組合的設定內容
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 欄位組合。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 不存在，或不屬於目前登入的使用者。
 */
columnPresetsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const columnPreset = await getColumnPresetOrThrow(firebaseUid, id);
  res.json({ columnPreset });
});

/**
 * @swagger
 * /screener/column-presets/{id}:
 *   patch:
 *     summary: 更新顯示欄位組合（名稱／欄位／是否為預設，皆選填）
 *     description: columns 有給的話是整組覆蓋，不是增量。
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               isDefault:
 *                 type: boolean
 *               columns:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     field:
 *                       type: string
 *     responses:
 *       200:
 *         description: 更新後的欄位組合。
 *       400:
 *         description: 有 field 既不是 filterCatalog 欄位也不是特殊欄位。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 不存在，或不屬於目前登入的使用者。
 *       409:
 *         description: 已經有同名的欄位組合。
 */
columnPresetsRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const body = req.body as { name?: unknown; columns?: unknown; isDefault?: unknown } | null;

  const columnPreset = await editColumnPreset(firebaseUid, id, {
    name: body?.name === undefined ? undefined : parseName(body.name),
    columns: body?.columns === undefined ? undefined : parseColumnFields(body.columns),
    isDefault: parseIsDefault(body?.isDefault),
  });
  res.json({ columnPreset });
});

/**
 * @swagger
 * /screener/column-presets/{id}:
 *   delete:
 *     summary: 刪除一組顯示欄位組合
 *     description: 如果某個 screener preset 最後檢視時用的是這組，會被自動清掉（改回 null），不影響那個 screener preset 本身。
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: 刪除成功，無回應內容。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 不存在，或不屬於目前登入的使用者。
 */
columnPresetsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removeColumnPreset(firebaseUid, id);
  res.status(204).end();
});
