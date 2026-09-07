import { getPrismaClient } from "@/adapters/neon/index.js";
import type { StockDetailPageMode } from "@/domainBusiness/user/stockDetailPreferences.types.js";

export interface StockDetailPreferencesRow {
  mode: StockDetailPageMode;
  visibleCardIds: string[];
}

export async function findStockDetailPreferences(firebaseUid: string): Promise<StockDetailPreferencesRow | null> {
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
): Promise<StockDetailPreferencesRow> {
  const prisma = getPrismaClient();
  const row = await prisma.stockDetailPreferences.upsert({
    where: { firebaseUid },
    create: { firebaseUid, mode, visibleCardIds },
    update: { mode, visibleCardIds },
    select: { mode: true, visibleCardIds: true },
  });
  return { mode: row.mode, visibleCardIds: row.visibleCardIds as unknown as string[] };
}
