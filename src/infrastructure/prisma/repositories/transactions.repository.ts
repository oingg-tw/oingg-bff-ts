import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { StockTransaction as StockTransactionRow } from "@/generated/prisma/client.js";
import type {
  StockTransaction,
  TransactionInput,
  TransactionUpdate,
} from "@/application/transactions/transactions.types.js";
import type { TransactionsPort } from "@/application/ports/transactions.js";

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toStockTransaction(row: StockTransactionRow): StockTransaction {
  return {
    id: row.id,
    symbol: row.symbol,
    action: row.action,
    quantity: row.quantity,
    price: row.price.toString(),
    fee: row.fee.toString(),
    tax: row.tax.toString(),
    tradeDate: toDateString(row.tradeDate),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listTransactions(firebaseUid: string, symbol?: string): Promise<StockTransaction[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.stockTransaction.findMany({
    where: { firebaseUid, ...(symbol ? { symbol } : {}) },
    orderBy: [{ tradeDate: "desc" }, { id: "desc" }],
  });
  return rows.map(toStockTransaction);
}

export async function findTransaction(firebaseUid: string, id: string): Promise<StockTransaction | null> {
  const prisma = getPrismaClient();
  const row = await prisma.stockTransaction.findFirst({ where: { firebaseUid, id } });
  return row ? toStockTransaction(row) : null;
}

export async function createTransaction(firebaseUid: string, input: TransactionInput): Promise<StockTransaction> {
  const prisma = getPrismaClient();
  const row = await prisma.stockTransaction.create({
    data: { firebaseUid, ...input, tradeDate: new Date(input.tradeDate) },
  });
  return toStockTransaction(row);
}

export async function updateTransaction(
  firebaseUid: string,
  id: string,
  update: TransactionUpdate,
): Promise<StockTransaction | null> {
  const prisma = getPrismaClient();
  const { tradeDate, ...rest } = update;
  const result = await prisma.stockTransaction.updateMany({
    where: { firebaseUid, id },
    data: { ...rest, ...(tradeDate !== undefined ? { tradeDate: new Date(tradeDate) } : {}) },
  });
  if (result.count === 0) {
    return null;
  }
  return findTransaction(firebaseUid, id);
}

export async function deleteTransaction(firebaseUid: string, id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const result = await prisma.stockTransaction.deleteMany({ where: { firebaseUid, id } });
  return result.count > 0;
}

export async function deleteTransactionsBySymbol(firebaseUid: string, symbol: string): Promise<number> {
  const prisma = getPrismaClient();
  const result = await prisma.stockTransaction.deleteMany({ where: { firebaseUid, symbol } });
  return result.count;
}

/**
 * TransactionsPort 的 Prisma 實作。
 *
 * 這裡不需要像 prismaHoldings 那樣翻譯 unique violation——交易紀錄沒有 unique constraint，重複的買賣
 * 本來就合法。"YYYY-MM-DD" 字串與 Date 的轉換是這一層唯一的翻譯工作，也刻意只發生在這一層。
 */
export const prismaTransactions: TransactionsPort = {
  list: listTransactions,
  find: findTransaction,
  create: createTransaction,
  update: updateTransaction,
  remove: deleteTransaction,
  removeBySymbol: deleteTransactionsBySymbol,
};
