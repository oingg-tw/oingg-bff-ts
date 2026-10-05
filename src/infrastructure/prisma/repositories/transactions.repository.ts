import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { StockTransaction as StockTransactionRow } from "@/generated/prisma/client.js";
import type {
  ImportedTransaction,
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
    source: row.source,
    externalRef: row.externalRef,
    importId: row.importId,
    costUnknown: row.costUnknown,
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

/**
 * `skipDuplicates` 靠的是 (firebase_uid, source, external_ref) 的唯一索引，所以重複的列會被跳過而不是
 * 讓整批失敗。**createMany 本身就是單一敘述、原子性的**，不需要再包一層 $transaction——「一次全寫或
 * 全不寫」是 Postgres 給的，不是我們實作的。
 */
export async function createManyImported(
  firebaseUid: string,
  importId: string,
  rows: readonly ImportedTransaction[],
): Promise<number> {
  const prisma = getPrismaClient();
  const result = await prisma.stockTransaction.createMany({
    data: rows.map((row) => ({ ...row, firebaseUid, importId, tradeDate: new Date(row.tradeDate) })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function existingExternalRefs(
  firebaseUid: string,
  source: string,
  refs: readonly string[],
): Promise<string[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.stockTransaction.findMany({
    where: { firebaseUid, source, externalRef: { in: [...refs] } },
    select: { externalRef: true },
  });
  // externalRef 在 schema 是可為 null 的，但有 source 的列一定有它——這個 filter 只是讓型別收斂。
  return rows.map((row) => row.externalRef).filter((ref): ref is string => ref !== null);
}

export async function listTransactionsByImportId(firebaseUid: string, importId: string): Promise<StockTransaction[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.stockTransaction.findMany({ where: { firebaseUid, importId } });
  return rows.map(toStockTransaction);
}

export async function deleteTransactionsByImportId(firebaseUid: string, importId: string): Promise<number> {
  const prisma = getPrismaClient();
  const result = await prisma.stockTransaction.deleteMany({ where: { firebaseUid, importId } });
  return result.count;
}

export async function deleteAllTransactions(firebaseUid: string): Promise<number> {
  const prisma = getPrismaClient();
  const result = await prisma.stockTransaction.deleteMany({ where: { firebaseUid } });
  return result.count;
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
  removeAll: deleteAllTransactions,
  createManyImported,
  existingExternalRefs,
  removeByImportId: deleteTransactionsByImportId,
  listByImportId: listTransactionsByImportId,
};
