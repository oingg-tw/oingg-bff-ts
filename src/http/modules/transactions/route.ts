import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { assertSymbolExists } from "@/application/proxy/stock/index.js";
import {
  addTransaction,
  editTransaction,
  getTransactionOrThrow,
  getTransactions,
  removeTransaction,
} from "@/application/transactions/transactions.service.js";
import type { TransactionsDeps } from "@/application/transactions/transactions.service.js";
import type { TransactionInput, TransactionUpdate } from "@/application/transactions/transactions.types.js";

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

/**
 * 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。
 * 這是 http 層不再依賴 infrastructure 的關鍵——它只認得 application 匯出的型別。
 */
export function createTransactionsRouter(deps: TransactionsDeps & AuthMiddlewareDeps): Router {
  const transactionsRouter = Router();
  transactionsRouter.use(createRequireAuth(deps));

  transactionsRouter.get("/", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
    const transactions = await getTransactions(firebaseUid, symbol, deps);
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

    await assertSymbolExists(input.symbol);
    const transaction = await addTransaction(firebaseUid, input, deps);
    res.status(201).json({ transaction });
  });

  transactionsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    const transaction = await getTransactionOrThrow(firebaseUid, id, deps);
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

    const transaction = await editTransaction(firebaseUid, id, update, deps);
    res.json({ transaction });
  });

  transactionsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    await removeTransaction(firebaseUid, id, deps);
    res.status(204).end();
  });

  return transactionsRouter;
}
