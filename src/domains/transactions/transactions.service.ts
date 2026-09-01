import { AppError } from "@/shared/errorHandler.js";
import { getStockQuote } from "@/domains/stock/index.js";
import {
  createTransaction,
  deleteTransaction,
  findTransaction,
  listTransactions,
  updateTransaction,
  type TransactionInput,
  type TransactionUpdate,
} from "@/domains/transactions/transactions.repository.js";
import type { StockTransaction, TransactionAction } from "@/domains/transactions/transactions.types.js";

const TRADE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function assertSymbolExists(symbol: string): Promise<void> {
  const quote = await getStockQuote(symbol);
  if (!quote) {
    throw new AppError(`Unknown stock symbol "${symbol}"`, 404);
  }
}

function assertValidAction(action: unknown): asserts action is TransactionAction {
  if (action !== "BUY" && action !== "SELL") {
    throw new AppError('"action" must be "BUY" or "SELL"', 400);
  }
}

function assertValidQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new AppError('"quantity" must be a positive integer', 400);
  }
}

function assertValidAmount(value: number, field: string, { allowZero }: { allowZero: boolean }): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new AppError(`"${field}" must be a ${allowZero ? "non-negative" : "positive"} number`, 400);
  }
}

function assertValidTradeDate(tradeDate: string): void {
  if (!TRADE_DATE_PATTERN.test(tradeDate) || Number.isNaN(Date.parse(tradeDate))) {
    throw new AppError('"tradeDate" must be a valid date in "YYYY-MM-DD" format', 400);
  }
}

export async function getTransactions(firebaseUid: string, symbol?: string): Promise<StockTransaction[]> {
  return listTransactions(firebaseUid, symbol);
}

export async function getTransactionOrThrow(firebaseUid: string, id: string): Promise<StockTransaction> {
  const transaction = await findTransaction(firebaseUid, id);
  if (!transaction) {
    throw new AppError(`Transaction ${id} not found`, 404);
  }
  return transaction;
}

export async function addTransaction(firebaseUid: string, input: TransactionInput): Promise<StockTransaction> {
  assertValidAction(input.action);
  assertValidQuantity(input.quantity);
  assertValidAmount(input.price, "price", { allowZero: false });
  assertValidAmount(input.fee, "fee", { allowZero: true });
  assertValidAmount(input.tax, "tax", { allowZero: true });
  assertValidTradeDate(input.tradeDate);
  await assertSymbolExists(input.symbol);

  return createTransaction(firebaseUid, input);
}

export async function editTransaction(
  firebaseUid: string,
  id: string,
  update: TransactionUpdate,
): Promise<StockTransaction> {
  if (update.action !== undefined) {
    assertValidAction(update.action);
  }
  if (update.quantity !== undefined) {
    assertValidQuantity(update.quantity);
  }
  if (update.price !== undefined) {
    assertValidAmount(update.price, "price", { allowZero: false });
  }
  if (update.fee !== undefined) {
    assertValidAmount(update.fee, "fee", { allowZero: true });
  }
  if (update.tax !== undefined) {
    assertValidAmount(update.tax, "tax", { allowZero: true });
  }
  if (update.tradeDate !== undefined) {
    assertValidTradeDate(update.tradeDate);
  }

  const transaction = await updateTransaction(firebaseUid, id, update);
  if (!transaction) {
    throw new AppError(`Transaction ${id} not found`, 404);
  }
  return transaction;
}

export async function removeTransaction(firebaseUid: string, id: string): Promise<void> {
  const deleted = await deleteTransaction(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Transaction ${id} not found`, 404);
  }
}
