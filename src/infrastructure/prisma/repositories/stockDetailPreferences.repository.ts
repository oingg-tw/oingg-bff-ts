import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { StoredStockDetailPreferences } from "@/application/ports/userPreferences.js";
import type { StockDetailPageMode } from "@/application/user/stockDetailPreferences.types.js";

export async function findStockDetailPreferences(firebaseUid: string): Promise<StoredStockDetailPreferences | null> {
  const prisma = getPrismaClient();
  const row = await prisma.stockDetailPreferences.findUnique({
    where: { firebaseUid },
    select: { mode: true, visibleCardIds: true },
  });
  return row ? { mode: row.mode, visibleCardIds: row.visibleCardIds as unknown as string[] } : null;
}

export async function upsertStockDetailPreferences(
  firebaseUid: string,
  mode: StockDetailPageMode,
  visibleCardIds: string[],
): Promise<StoredStockDetailPreferences> {
  const prisma = getPrismaClient();
  const row = await prisma.stockDetailPreferences.upsert({
    where: { firebaseUid },
    create: { firebaseUid, mode, visibleCardIds },
    update: { mode, visibleCardIds },
    select: { mode: true, visibleCardIds: true },
  });
  return { mode: row.mode, visibleCardIds: row.visibleCardIds as unknown as string[] };
}
