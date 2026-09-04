import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { requireAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import {
  addTransaction,
  editTransaction,
  getTransactionOrThrow,
  getTransactions,
  removeTransaction,
} from "@/domains/transactions/transactions.service.js";
import type { TransactionInput, TransactionUpdate } from "@/domains/transactions/transactions.repository.js";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): string {
  return parseUuidParam(raw, "transaction");
}

/** action's own enum validity (BUY/SELL) is checked in transactions.service.ts's assertValidAction — kept
 * as a plain string here so that check's error message/behavior doesn't change. */
const createTransactionSchema = z.object({
  symbol: z.string().trim().min(1, '"symbol" is required'),
  action: z.string(),
  quantity: z.number(),
  price: z.number(),
  fee: z.number().optional(),
  tax: z.number().optional(),
  tradeDate: z.string(),
  note: z.string().nullish(),
});

const updateTransactionSchema = z.object({
  action: z.string().optional(),
  quantity: z.number().optional(),
  price: z.number().optional(),
  fee: z.number().optional(),
  tax: z.number().optional(),
  tradeDate: z.string().optional(),
  note: z.string().nullish(),
});

/**
 * @swagger
 * /transactions:
 *   get:
 *     summary: 列出目前登入使用者的交易日誌（買進／賣出紀錄）
 *     tags:
 *       - Transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: symbol
 *         schema:
 *           type: string
 *         description: 只列出這個股票代號的交易紀錄。
 *     responses:
 *       200:
 *         description: 交易紀錄清單（依交易日期新到舊排序）。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
transactionsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
  const transactions = await getTransactions(firebaseUid, symbol);
  res.json({ transactions });
});

/**
 * @swagger
 * /transactions:
 *   post:
 *     summary: 新增一筆交易日誌（買進／賣出紀錄）
 *     description: 這是獨立的交易日誌，不會自動更新 /holdings 的持股數量；會先確認 symbol 在 twse/tpex 其中一邊查得到資料。
 *     tags:
 *       - Transactions
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
 *               - action
 *               - quantity
 *               - price
 *               - tradeDate
 *             properties:
 *               symbol:
 *                 type: string
 *                 example: "2330"
 *               action:
 *                 type: string
 *                 enum: [BUY, SELL]
 *               quantity:
 *                 type: integer
 *                 example: 1000
 *               price:
 *                 type: number
 *                 example: 550.5
 *               fee:
 *                 type: number
 *                 default: 0
 *               tax:
 *                 type: number
 *                 default: 0
 *               tradeDate:
 *                 type: string
 *                 example: "2026-08-30"
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       201:
 *         description: 新增成功的交易紀錄。
 *       400:
 *         description: 缺少必填欄位，或欄位型別/數值不合法。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 此股票代號在 twse/tpex 都查無資料。
 */
transactionsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(createTransactionSchema, req.body);

  const input: TransactionInput = {
    symbol: body.symbol,
    action: body.action as TransactionInput["action"],
    quantity: body.quantity,
    price: body.price,
    fee: body.fee ?? 0,
    tax: body.tax ?? 0,
    tradeDate: body.tradeDate,
    note: body.note ?? null,
  };

  const transaction = await addTransaction(firebaseUid, input);
  res.status(201).json({ transaction });
});

/**
 * @swagger
 * /transactions/{id}:
 *   get:
 *     summary: 查詢單一交易紀錄
 *     tags:
 *       - Transactions
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
 *         description: 交易紀錄。
 *       400:
 *         description: id 不是合法的 UUID。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 此 id 不存在，或不屬於目前登入的使用者。
 */
transactionsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const transaction = await getTransactionOrThrow(firebaseUid, id);
  res.json({ transaction });
});

/**
 * @swagger
 * /transactions/{id}:
 *   patch:
 *     summary: 更新一筆交易紀錄
 *     description: symbol 不可變更（要換 symbol 請刪除後重新新增）。
 *     tags:
 *       - Transactions
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
 *               action:
 *                 type: string
 *                 enum: [BUY, SELL]
 *               quantity:
 *                 type: integer
 *               price:
 *                 type: number
 *               fee:
 *                 type: number
 *               tax:
 *                 type: number
 *               tradeDate:
 *                 type: string
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: 更新後的交易紀錄。
 *       400:
 *         description: id 不是合法的 UUID，或欄位型別/數值不合法。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 此 id 不存在，或不屬於目前登入的使用者。
 */
transactionsRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const body = parseBody(updateTransactionSchema, req.body ?? {});

  const update: TransactionUpdate = {};
  if (body.action !== undefined) {
    update.action = body.action as TransactionUpdate["action"];
  }
  if (body.quantity !== undefined) {
    update.quantity = body.quantity;
  }
  if (body.price !== undefined) {
    update.price = body.price;
  }
  if (body.fee !== undefined) {
    update.fee = body.fee;
  }
  if (body.tax !== undefined) {
    update.tax = body.tax;
  }
  if (body.tradeDate !== undefined) {
    update.tradeDate = body.tradeDate;
  }
  if (body.note !== undefined) {
    update.note = body.note;
  }

  const transaction = await editTransaction(firebaseUid, id, update);
  res.json({ transaction });
});

/**
 * @swagger
 * /transactions/{id}:
 *   delete:
 *     summary: 刪除一筆交易紀錄
 *     tags:
 *       - Transactions
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
transactionsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removeTransaction(firebaseUid, id);
  res.status(204).end();
});
