import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { parseScreenerFilters } from "./screenerFilterInput.js";
import {
  addPreset,
  editPreset,
  getPresetOrThrow,
  getPresets,
  removePreset,
  runPreset,
} from "./screenerPresets.service.js";

export const screenerPresetsRouter = Router();

screenerPresetsRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(`Invalid preset id "${raw}"`, 400);
  }
  return id;
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError('"name" is required', 400);
  }
  return value.trim();
}

/**
 * @swagger
 * /screener/presets:
 *   get:
 *     summary: 列出目前使用者儲存的篩選組合
 *     tags:
 *       - Screener
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 篩選組合清單（含每組的完整 filters），依建立時間新到舊排序。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
screenerPresetsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const presets = await getPresets(firebaseUid);
  res.json({ presets });
});

/**
 * @swagger
 * /screener/presets:
 *   post:
 *     summary: 儲存一組新的篩選組合
 *     description: >
 *       例如 name="績優股"、filters=[{field:"roe.roeTtmPct",min:30,max:null},{field:"margins.grossMarginTtm",min:60,max:null}]。
 *       filters 格式跟 POST /screener 完全一樣。同一使用者底下 name 不能重複。
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
 *               - filters
 *             properties:
 *               name:
 *                 type: string
 *                 example: "績優股"
 *               filters:
 *                 type: array
 *                 description: 可以是空陣列（先建立組合、之後再用 PATCH 補條件）。
 *                 items:
 *                   type: object
 *                   required:
 *                     - field
 *                   properties:
 *                     field:
 *                       type: string
 *                       example: "roe.roeTtmPct"
 *                     min:
 *                       type: number
 *                       nullable: true
 *                       example: 30
 *                     max:
 *                       type: number
 *                       nullable: true
 *                       example: null
 *                     exclude:
 *                       type: boolean
 *                       default: false
 *     responses:
 *       201:
 *         description: 新增成功的篩選組合。
 *       400:
 *         description: 缺少 name/filters，或有 field 不存在於 filterCatalog。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       409:
 *         description: 已經有同名的篩選組合。
 */
screenerPresetsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = req.body as { name?: unknown; filters?: unknown } | null;
  const name = parseName(body?.name);
  const filters = parseScreenerFilters(body?.filters);

  const preset = await addPreset(firebaseUid, name, filters);
  res.status(201).json({ preset });
});

/**
 * @swagger
 * /screener/presets/{id}:
 *   get:
 *     summary: 查詢單一篩選組合的設定內容
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
 *         description: 篩選組合的名稱與 filters。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 不存在，或不屬於目前登入的使用者。
 */
screenerPresetsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const preset = await getPresetOrThrow(firebaseUid, id);
  res.json({ preset });
});

/**
 * @swagger
 * /screener/presets/{id}:
 *   patch:
 *     summary: 更新篩選組合的名稱和／或條件
 *     description: filters 有給的話是整組覆蓋（不是增量），跟 PATCH /screener/column-presets/{id} 的 columns 同樣邏輯。
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
 *               filters:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     field:
 *                       type: string
 *                     min:
 *                       type: number
 *                       nullable: true
 *                     max:
 *                       type: number
 *                       nullable: true
 *                     exclude:
 *                       type: boolean
 *     responses:
 *       200:
 *         description: 更新後的篩選組合。
 *       400:
 *         description: 有 field 不存在於 filterCatalog。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 不存在，或不屬於目前登入的使用者。
 *       409:
 *         description: 已經有同名的篩選組合。
 */
screenerPresetsRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const body = req.body as { name?: unknown; filters?: unknown } | null;

  const preset = await editPreset(firebaseUid, id, {
    name: body?.name === undefined ? undefined : parseName(body.name),
    filters: body?.filters === undefined ? undefined : parseScreenerFilters(body.filters),
  });
  res.json({ preset });
});

/**
 * @swagger
 * /screener/presets/{id}:
 *   delete:
 *     summary: 刪除一組篩選組合
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
screenerPresetsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removePreset(firebaseUid, id);
  res.status(204).end();
});

function parseOptionalColumnPresetIdQuery(raw: unknown): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(`Invalid columnPresetId "${String(raw)}"`, 400);
  }
  return value;
}

/**
 * @swagger
 * /screener/presets/{id}/run:
 *   get:
 *     summary: 用已儲存的篩選組合查詢股票——只要帶 id
 *     description: >
 *       一次回傳這組篩選條件本身（preset）跟符合條件的股票（screener），前端不用另外組 filters。
 *
 *       顯示欄位解析順序：query 給的 columnPresetId（有給的話，也會記成這組 preset「下次預設顯示」
 *       的欄位組合，也就是切換一次、之後重開一樣是這個）→ 這組 preset 上次檢視用的欄位組合 → 使用者
 *       自己的預設欄位組合 → 系統內建常用欄位（股價、PER、PBR、殖利率）。回應的 columnPresetId 標明
 *       實際套用的是哪一組（null 代表系統內建）。
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
 *       - in: query
 *         name: columnPresetId
 *         schema:
 *           type: integer
 *         description: 切換成用這組欄位組合檢視，並記成這個 preset 下次的預設欄位組合。
 *     responses:
 *       200:
 *         description: preset（名稱與條件）+ screener 結果（count/columns/results）+ 實際套用的 columnPresetId。
 *       400:
 *         description: columnPresetId 不是合法的正整數。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: preset 不存在／不屬於使用者，或指定的 columnPresetId 不存在／不屬於使用者。
 */
screenerPresetsRouter.get("/:id/run", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const columnPresetId = parseOptionalColumnPresetIdQuery(req.query.columnPresetId);
  const result = await runPreset(firebaseUid, id, columnPresetId);
  res.json(result);
});
