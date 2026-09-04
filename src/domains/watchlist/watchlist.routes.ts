import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { requireAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import {
  addWatchlistItem,
  editWatchlistItemNote,
  getWatchlist,
  getWatchlistItemOrThrow,
  removeWatchlistItem,
} from "@/domains/watchlist/watchlist.service.js";

export const watchlistRouter = Router();

watchlistRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): string {
  return parseUuidParam(raw, "watchlist item");
}

const addWatchlistItemSchema = z.object({
  symbol: z.string().trim().min(1, '"symbol" is required'),
  note: z.string().nullish(),
});

const updateWatchlistItemSchema = z.object({
  note: z.string().nullish(),
});

/**
 * @swagger
 * /watchlist:
 *   get:
 *     summary: 列出目前登入使用者的自選股清單
 *     tags:
 *       - Watchlist
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 自選股清單（依加入時間新到舊排序）。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
watchlistRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const items = await getWatchlist(firebaseUid);
  res.json({ items });
});

/**
 * @swagger
 * /watchlist:
 *   post:
 *     summary: 加入一檔股票到自選股清單
 *     description: 會先確認 symbol 在 twse/tpex 其中一邊查得到資料，查不到回 404；同一使用者重複加入同一 symbol 回 409。
 *     tags:
 *       - Watchlist
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
 *             properties:
 *               symbol:
 *                 type: string
 *                 example: "2330"
 *               note:
 *                 type: string
 *                 nullable: true
 *                 example: "等回檔到 500 再加碼"
 *     responses:
 *       201:
 *         description: 新增成功的自選股項目。
 *       400:
 *         description: 缺少 symbol，或 note 型別不是字串。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 此股票代號在 twse/tpex 都查無資料。
 *       409:
 *         description: 這個 symbol 已經在自選股清單裡。
 */
watchlistRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(addWatchlistItemSchema, req.body);

  const item = await addWatchlistItem(firebaseUid, body.symbol, body.note ?? null);
  res.status(201).json({ item });
});

/**
 * @swagger
 * /watchlist/{id}:
 *   get:
 *     summary: 查詢自選股清單中的單一項目
 *     tags:
 *       - Watchlist
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
 *       200:
 *         description: 自選股項目。
 *       400:
 *         description: id 不是合法的 UUID。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 此 id 不存在，或不屬於目前登入的使用者。
 */
watchlistRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const item = await getWatchlistItemOrThrow(firebaseUid, id);
  res.json({ item });
});

/**
 * @swagger
 * /watchlist/{id}:
 *   patch:
 *     summary: 更新自選股項目的筆記
 *     description: 目前只能改 note，symbol 不可變更（要換 symbol 請刪除後重新加入）。
 *     tags:
 *       - Watchlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: 更新後的自選股項目。
 *       400:
 *         description: id 不是合法的 UUID，或 note 型別不是字串。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 此 id 不存在，或不屬於目前登入的使用者。
 */
watchlistRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const body = parseBody(updateWatchlistItemSchema, req.body ?? {});
  const item = await editWatchlistItemNote(firebaseUid, id, body.note ?? null);
  res.json({ item });
});

/**
 * @swagger
 * /watchlist/{id}:
 *   delete:
 *     summary: 從自選股清單移除一個項目
 *     tags:
 *       - Watchlist
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
 *       204:
 *         description: 刪除成功，無回應內容。
 *       400:
 *         description: id 不是合法的 UUID。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 此 id 不存在，或不屬於目前登入的使用者。
 */
watchlistRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removeWatchlistItem(firebaseUid, id);
  res.status(204).end();
});
