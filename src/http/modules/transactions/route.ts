import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { booleanQueryParam, parseBody, parseQuery } from "@/shared/validation.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { assertSymbolExists, type StockProxyDeps } from "@/application/proxy/stock/stock.service.js";
import {
  addTransaction,
  editTransaction,
  getTransactionOrThrow,
  getTransactions,
  removeAllTransactions,
  removeTransaction,
} from "@/application/transactions/transactions.service.js";
import type { TransactionsDeps } from "@/application/transactions/transactions.service.js";
import {
  importTransactions,
  revertTransactionImport,
  type TransactionImportDeps,
} from "@/application/transactions/transactionImport.service.js";
import type { TransactionInput, TransactionUpdate } from "@/application/transactions/transactions.types.js";

const SHORTFALL_DETAIL = "Some sells exceed the shares held at that point; see shortfalls for the opening positions to add";

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
  /** 成本不明的取得可以省略（視為 0）；其他情況必填，見 resolvePrice。 */
  price: z.number().optional(),
  costUnknown: z.boolean().optional(),
  fee: z.number().optional(),
  tax: z.number().optional(),
  tradeDate: z.string(),
  note: z.string().nullish(),
});

/**
 * 批次匯入。**券商 CSV 由前端在瀏覽器裡解析**（Big5 解碼、跳過小計列、檢查算術），原始檔案不上傳；
 * 這裡收到的是已正規化、跟券商無關的交易列。換一家券商只要改前端，這份契約不用動。
 *
 * `action` 跟單筆的 schema 一樣留成字串，由 service 的 assertValidTransactionInput 驗——這樣兩條
 * 路徑的錯誤訊息一致。
 */
export const importTransactionsSchema = z.object({
  source: z.string(),
  dryRun: z.boolean().optional(),
  openingPositions: z
    .array(
      z.object({
        symbol: z.string().trim().min(1),
        quantity: z.number(),
        averageCost: z.number(),
      }),
    )
    .optional(),
  transactions: z.array(
    z.object({
      externalRef: z.string().trim().min(1),
      tradeDate: z.string(),
      symbol: z.string().trim().min(1),
      action: z.string(),
      quantity: z.number(),
      price: z.number().optional(),
      fee: z.number().optional(),
      tax: z.number().optional(),
      costUnknown: z.boolean().optional(),
    }),
  ),
});

/**
 * price 只有成本不明的取得可以省略。其他情況省略就是呼叫端漏了，回 400——不能默默當成 0，那會把
 * 一筆真的買進變成「免費取得」。
 */
function resolvePrice(price: number | undefined, costUnknown: boolean | undefined): number {
  if (price !== undefined) {
    return price;
  }
  if (costUnknown) {
    return 0;
  }
  throw new AppError('"price" is required unless "costUnknown" is true', 400);
}

export const clearTransactionsQuerySchema = z.object({ all: booleanQueryParam("all") });

export const updateTransactionSchema = z.object({
  costUnknown: z.boolean().optional(),
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
export function createTransactionsRouter(
  deps: TransactionsDeps & StockProxyDeps & TransactionImportDeps & AuthMiddlewareDeps,
): Router {
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
      price: resolvePrice(body.price, body.costUnknown),
      fee: body.fee ?? 0,
      tax: body.tax ?? 0,
      tradeDate: body.tradeDate,
      note: body.note ?? null,
      costUnknown: body.costUnknown ?? false,
    };

    await assertSymbolExists(input.symbol, deps);
    const transaction = await addTransaction(firebaseUid, input, deps);
    res.status(201).json({ transaction });
  });

  /**
   * 清空整本帳。**必須明確帶 `?all=true`**，否則 400。
   *
   * 理由是一個實際會發生的前端缺陷：Express 不分尾斜線，`DELETE /transactions/` 會落到這條路由，而
   * 前端只要有一處用空字串組出 `/transactions/${id}`，沒有這道保險就會把使用者整本帳清掉、沒有任何
   * 錯誤。有了它，那個缺陷會變成一個看得見的 400。這是防資料遺失，不是多一個選項。
   */
  transactionsRouter.delete("/", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const { all } = parseQuery(clearTransactionsQuerySchema, req.query);
    if (all !== true) {
      throw new AppError('Clearing every transaction requires "all=true"', 400);
    }
    const deleted = await removeAllTransactions(firebaseUid, deps);
    res.status(200).json({ deleted });
  });

  /**
   * **註冊順序有意義**：這兩條必須排在 `/:id` 之前，否則 "import" 會被當成 id 去解析 UUID 然後回 400。
   */
  transactionsRouter.post("/import", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(importTransactionsSchema, req.body);

    const outcome = await importTransactions(
      firebaseUid,
      {
        source: body.source,
        dryRun: body.dryRun ?? false,
        openingPositions: body.openingPositions ?? [],
        transactions: body.transactions.map((row) => ({
          ...row,
          action: row.action as TransactionInput["action"],
          price: resolvePrice(row.price, row.costUnknown),
          fee: row.fee ?? 0,
          tax: row.tax ?? 0,
          costUnknown: row.costUnknown ?? false,
        })),
      },
      deps,
    );

    // 422 的 shortfalls 是 RFC 9457 的擴充成員（2026-10-08）：跟 details 不同，production 也會送，而且仍是
    // 回應頂層的 `shortfalls`，前端原本讀的位置不變。
    if (!outcome.ok) {
      throw new AppError(SHORTFALL_DETAIL, 422, undefined, "ledger_shortfall", { shortfalls: outcome.shortfalls });
    }
    res.status(outcome.result.importId ? 201 : 200).json(outcome.result);
  });

  transactionsRouter.delete("/import/:importId", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const importId = parseUuidParam(req.params.importId ?? "", "import");

    const outcome = await revertTransactionImport(firebaseUid, importId, deps);
    if (!outcome.ok) {
      throw new AppError(SHORTFALL_DETAIL, 422, undefined, "ledger_shortfall", { shortfalls: outcome.shortfalls });
    }
    res.status(200).json({ deleted: outcome.deleted });
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
    if (body.costUnknown !== undefined) {
      update.costUnknown = body.costUnknown;
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
