import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import type {
  StockTransaction,
  TransactionAction,
  TransactionInput,
  TransactionUpdate,
} from "@/application/transactions/transactions.types.js";

export type TransactionsDeps = Pick<AppDeps, "transactions">;

const TRADE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertValidAction(action: unknown): asserts action is TransactionAction {
  if (action !== "BUY" && action !== "SELL") {
    throw new AppError('"action" must be "BUY" or "SELL"', 400);
  }
}

/** 上界對齊資料庫欄位——理由與 holdings.service.ts 的同名常數相同（缺上界時溢出會變 500 而非 400）。 */
const MAX_INT32 = 2_147_483_647;
/**
 * `Decimal(18,4)` 的真正上限是 99999999999999.9999，但那個字面值在 double 裡**不可精確表示**
 * （14 位整數加 4 位小數超過 53 bit 尾數，oxlint 的 no-loss-of-precision 抓到的就是這個）。
 * 所以改用可精確表示的 1e14 當**開區間**上界：小於 1e14 的值整數部分一定在 14 位內，必然放得下。
 * 代價是多擋掉 [99999999999999.9999, 1e14) 這個寬度 0.0001 的縫，那個範圍沒有真實用途。
 */
const DECIMAL_18_4_EXCLUSIVE_MAX = 1e14;

function assertValidQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_INT32) {
    throw new AppError(`"quantity" must be a positive integer no greater than ${MAX_INT32}`, 400);
  }
}

function assertValidAmount(value: number, field: string, { allowZero }: { allowZero: boolean }): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0) || value >= DECIMAL_18_4_EXCLUSIVE_MAX) {
    throw new AppError(`"${field}" must be a ${allowZero ? "non-negative" : "positive"} number within the column precision`, 400);
  }
}

function assertValidTradeDate(tradeDate: string): void {
  if (!TRADE_DATE_PATTERN.test(tradeDate) || Number.isNaN(Date.parse(tradeDate))) {
    throw new AppError('"tradeDate" must be a valid date in "YYYY-MM-DD" format', 400);
  }
}

export async function getTransactions(
  firebaseUid: string,
  symbol: string | undefined,
  deps: TransactionsDeps,
): Promise<StockTransaction[]> {
  return deps.transactions.list(firebaseUid, symbol);
}

export async function getTransactionOrThrow(
  firebaseUid: string,
  id: string,
  deps: TransactionsDeps,
): Promise<StockTransaction> {
  const transaction = await deps.transactions.find(firebaseUid, id);
  if (!transaction) {
    throw new AppError(`Transaction ${id} not found`, 404);
  }
  return transaction;
}

/**
 * Symbol existence is validated by the caller (transactions.routes.ts, via bff-ts's
 * stock.assertSymbolExists) before this is invoked — this domain's own service has no reason to reach
 * across into the stock pass-through's live quote data itself.
 */
export async function addTransaction(
  firebaseUid: string,
  input: TransactionInput,
  deps: TransactionsDeps,
): Promise<StockTransaction> {
  assertValidAction(input.action);
  assertValidQuantity(input.quantity);
  assertValidAmount(input.price, "price", { allowZero: false });
  assertValidAmount(input.fee, "fee", { allowZero: true });
  assertValidAmount(input.tax, "tax", { allowZero: true });
  assertValidTradeDate(input.tradeDate);

  return deps.transactions.create(firebaseUid, input);
}

export async function editTransaction(
  firebaseUid: string,
  id: string,
  update: TransactionUpdate,
  deps: TransactionsDeps,
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

  const transaction = await deps.transactions.update(firebaseUid, id, update);
  if (!transaction) {
    throw new AppError(`Transaction ${id} not found`, 404);
  }
  return transaction;
}

export async function removeTransaction(firebaseUid: string, id: string, deps: TransactionsDeps): Promise<void> {
  const deleted = await deps.transactions.remove(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Transaction ${id} not found`, 404);
  }
}
