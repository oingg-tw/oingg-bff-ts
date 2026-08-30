import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { addHolding, editHolding, getHoldingOrThrow, getHoldings, removeHolding } from "./holdings.service.js";
import type { HoldingUpdate } from "./holdings.repository.js";

export const holdingsRouter = Router();

holdingsRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(`Invalid holding id "${raw}"`, 400);
  }
  return id;
}

function parseNote(note: unknown): string | null {
  if (note === undefined || note === null) {
    return null;
  }
  if (typeof note !== "string") {
    throw new AppError('"note" must be a string', 400);
  }
  return note;
}

interface CreateHoldingBody {
  symbol?: unknown;
  quantity?: unknown;
  averageCost?: unknown;
  note?: unknown;
}

/**
 * @swagger
 * /holdings:
 *   get:
 *     summary: 列出目前登入使用者的持股
 *     tags:
 *       - Holdings
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 持股清單（依建立時間新到舊排序）。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
holdingsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const holdings = await getHoldings(firebaseUid);
  res.json({ holdings });
});

/**
 * @swagger
 * /holdings:
 *   post:
 *     summary: 新增一筆持股
 *     description: 持股是獨立維護的資料，不會從交易日誌（買進／賣出紀錄）自動計算；同一使用者同一 symbol 只能有一筆持股（重複回 409，請改用編輯）。會先確認 symbol 在 twse/tpex 其中一邊查得到資料。
 *     tags:
 *       - Holdings
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - symbol
 *               - quantity
 *               - averageCost
 *             properties:
 *               symbol:
 *                 type: string
 *                 example: "2330"
 *               quantity:
 *                 type: integer
 *                 example: 1000
 *               averageCost:
 *                 type: number
 *                 example: 550.5
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       201:
 *         description: 新增成功的持股。
 *       400:
 *         description: 缺少必填欄位，或欄位型別/數值不合法。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 此股票代號在 twse/tpex 都查無資料。
 *       409:
 *         description: 這個 symbol 已經有持股紀錄了。
 */
holdingsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = (req.body ?? {}) as CreateHoldingBody;

  if (typeof body.symbol !== "string" || body.symbol.trim() === "") {
    throw new AppError('"symbol" is required', 400);
  }
  if (typeof body.quantity !== "number") {
    throw new AppError('"quantity" is required and must be a number', 400);
  }
  if (typeof body.averageCost !== "number") {
    throw new AppError('"averageCost" is required and must be a number', 400);
  }

  const holding = await addHolding(firebaseUid, body.symbol.trim(), body.quantity, body.averageCost, parseNote(body.note));
  res.status(201).json({ holding });
});

/**
 * @swagger
 * /holdings/{id}:
 *   get:
 *     summary: 查詢單一持股
 *     tags:
 *       - Holdings
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
 *         description: 持股資料。
 *       400:
 *         description: id 不是合法的正整數。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 此 id 不存在，或不屬於目前登入的使用者。
 */
holdingsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const holding = await getHoldingOrThrow(firebaseUid, id);
  res.json({ holding });
});

/**
 * @swagger
 * /holdings/{id}:
 *   patch:
 *     summary: 更新持股（股數／平均成本／備註）
 *     description: symbol 不可變更（要換 symbol 請刪除後重新加入）。
 *     tags:
 *       - Holdings
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
 *               quantity:
 *                 type: integer
 *               averageCost:
 *                 type: number
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: 更新後的持股。
 *       400:
 *         description: id 不是合法的正整數，或欄位型別/數值不合法。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 此 id 不存在，或不屬於目前登入的使用者。
 */
holdingsRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const body = (req.body ?? {}) as CreateHoldingBody;

  const update: HoldingUpdate = {};
  if (body.quantity !== undefined) {
    if (typeof body.quantity !== "number") {
      throw new AppError('"quantity" must be a number', 400);
    }
    update.quantity = body.quantity;
  }
  if (body.averageCost !== undefined) {
    if (typeof body.averageCost !== "number") {
      throw new AppError('"averageCost" must be a number', 400);
    }
    update.averageCost = body.averageCost;
  }
  if (body.note !== undefined) {
    update.note = parseNote(body.note);
  }

  const holding = await editHolding(firebaseUid, id, update);
  res.json({ holding });
});

/**
 * @swagger
 * /holdings/{id}:
 *   delete:
 *     summary: 刪除一筆持股
 *     tags:
 *       - Holdings
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
 *       400:
 *         description: id 不是合法的正整數。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 此 id 不存在，或不屬於目前登入的使用者。
 */
holdingsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removeHolding(firebaseUid, id);
  res.status(204).end();
});
