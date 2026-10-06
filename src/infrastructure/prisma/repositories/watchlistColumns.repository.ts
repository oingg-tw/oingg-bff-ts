import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { WatchlistColumn } from "@/application/user/watchlistColumns.types.js";

export async function findWatchlistColumns(firebaseUid: string): Promise<WatchlistColumn[] | null> {
  const prisma = getPrismaClient();
  const row = await prisma.watchlistColumnPreferences.findUnique({ where: { firebaseUid }, select: { columns: true } });
  // JSON 欄位：寫入時已經過 route 的 zod 驗證，這裡的轉型只是把 Prisma 的 JsonValue 收斂成宣告的形狀。
  return row ? (row.columns as unknown as WatchlistColumn[]) : null;
}

export async function upsertWatchlistColumns(firebaseUid: string, columns: WatchlistColumn[]): Promise<WatchlistColumn[]> {
  const prisma = getPrismaClient();
  const json = columns as unknown as object[];
  const row = await prisma.watchlistColumnPreferences.upsert({
    where: { firebaseUid },
    create: { firebaseUid, columns: json },
    update: { columns: json },
    select: { columns: true },
  });
  return row.columns as unknown as WatchlistColumn[];
}
