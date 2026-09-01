import { getPrismaClient } from "@/adapters/neon/index.js";
import type { WatchlistItem as WatchlistItemRow } from "@/generated/prisma/client.js";
import type { WatchlistItem } from "@/domains/watchlist/watchlist.types.js";

function toWatchlistItem(row: WatchlistItemRow): WatchlistItem {
  return {
    id: row.id,
    symbol: row.symbol,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listWatchlistItems(firebaseUid: string): Promise<WatchlistItem[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.watchlistItem.findMany({
    where: { firebaseUid },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toWatchlistItem);
}

export async function findWatchlistItem(firebaseUid: string, id: string): Promise<WatchlistItem | null> {
  const prisma = getPrismaClient();
  const row = await prisma.watchlistItem.findFirst({ where: { firebaseUid, id } });
  return row ? toWatchlistItem(row) : null;
}

export async function createWatchlistItem(
  firebaseUid: string,
  symbol: string,
  note: string | null,
): Promise<WatchlistItem> {
  const prisma = getPrismaClient();
  const row = await prisma.watchlistItem.create({ data: { firebaseUid, symbol, note } });
  return toWatchlistItem(row);
}

export async function updateWatchlistItemNote(
  firebaseUid: string,
  id: string,
  note: string | null,
): Promise<WatchlistItem | null> {
  const prisma = getPrismaClient();
  const result = await prisma.watchlistItem.updateMany({ where: { firebaseUid, id }, data: { note } });
  if (result.count === 0) {
    return null;
  }
  return findWatchlistItem(firebaseUid, id);
}

export async function deleteWatchlistItem(firebaseUid: string, id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const result = await prisma.watchlistItem.deleteMany({ where: { firebaseUid, id } });
  return result.count > 0;
}
