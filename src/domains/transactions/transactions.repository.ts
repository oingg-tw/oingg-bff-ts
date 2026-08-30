import { getPrismaClient } from "../../adapters/neon/index.js";
import type { StockTransaction as StockTransactionRow } from "../../generated/prisma/client.js";
import type { StockTransaction, TransactionAction } from "./transactions.types.js";

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

export async function findTransaction(firebaseUid: string, id: number): Promise<StockTransaction | null> {
  const prisma = getPrismaClient();
  const row = await prisma.stockTransaction.findFirst({ where: { firebaseUid, id } });
  return row ? toStockTransaction(row) : null;
}

export interface TransactionInput {
  symbol: string;
  action: TransactionAction;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  tradeDate: string;
  note: string | null;
}

export async function createTransaction(firebaseUid: string, input: TransactionInput): Promise<StockTransaction> {
  const prisma = getPrismaClient();
  const row = await prisma.stockTransaction.create({
    data: { firebaseUid, ...input, tradeDate: new Date(input.tradeDate) },
  });
  return toStockTransaction(row);
}

export interface TransactionUpdate {
  action?: TransactionAction;
  quantity?: number;
  price?: number;
  fee?: number;
  tax?: number;
  tradeDate?: string;
  note?: string | null;
}

export async function updateTransaction(
  firebaseUid: string,
  id: number,
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

export async function deleteTransaction(firebaseUid: string, id: number): Promise<boolean> {
  const prisma = getPrismaClient();
  const result = await prisma.stockTransaction.deleteMany({ where: { firebaseUid, id } });
  return result.count > 0;
}
