import { Prisma } from "@/generated/prisma/client.js";
import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { WatchlistItem as WatchlistItemRow } from "@/generated/prisma/client.js";
import type { WatchlistItem } from "@/application/watchlist/watchlist.types.js";
import type { WatchlistPort } from "@/application/ports/watchlist.js";

/** Prisma's code for a unique constraint violation (wraps Postgres's own 23505). */
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

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

/**
 * WatchlistPort 的 Prisma 實作。
 *
 * create 在這裡把 Prisma 的 unique violation（P2002，包住 Postgres 的 23505）翻譯成
 * `{ ok: false, reason: "duplicate" }`——重構前這個 catch 住在 service 層，等於 application 知道自己被
 * Prisma 實作；換掉驅動時那個 catch 會安靜地失效，409 變 500 而且沒有測試會紅。翻譯是這一層的責任。
 */
export const prismaWatchlist: WatchlistPort = {
  list: listWatchlistItems,
  find: findWatchlistItem,
  async create(firebaseUid, symbol, note) {
    try {
      return { ok: true, item: await createWatchlistItem(firebaseUid, symbol, note) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
        return { ok: false, reason: "duplicate" };
      }
      throw error;
    }
  },
  updateNote: updateWatchlistItemNote,
  remove: deleteWatchlistItem,
};
