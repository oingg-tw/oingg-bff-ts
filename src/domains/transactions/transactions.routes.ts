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
export const createTransactionSchema = z.object({
  symbol: z.string().trim().min(1, '"symbol" is required'),
  action: z.string(),
  quantity: z.number(),
  price: z.number(),
  fee: z.number().optional(),
  tax: z.number().optional(),
  tradeDate: z.string(),
  note: z.string().nullish(),
});

export const updateTransactionSchema = z.object({
  action: z.string().optional(),
  quantity: z.number().optional(),
  price: z.number().optional(),
  fee: z.number().optional(),
  tax: z.number().optional(),
  tradeDate: z.string().optional(),
  note: z.string().nullish(),
});

transactionsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
  const transactions = await getTransactions(firebaseUid, symbol);
  res.json({ transactions });
});

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

transactionsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const transaction = await getTransactionOrThrow(firebaseUid, id);
  res.json({ transaction });
});

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

transactionsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removeTransaction(firebaseUid, id);
  res.status(204).end();
});
