import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { StoredStockDetailPreferences } from "@/application/ports/userPreferences.js";
import type { StockDetailPageMode } from "@/application/user/stockDetailPreferences.types.js";

export async function findStockDetailPreferences(firebaseUid: string): Promise<StoredStockDetailPreferences | null> {
  const prisma = getPrismaClient();
  const row = await prisma.stockDetailPreferences.findUnique({
    where: { firebaseUid },
    select: { mode: true, visibleCardIds: true, pinnedMetricSlugs: true },
  });
  return row
    ? {
        mode: row.mode,
        visibleCardIds: row.visibleCardIds as unknown as string[],
        // 這一欄可為 null 而 visibleCardIds 不行，所以不能一起做同樣的 cast。
        pinnedMetricSlugs: row.pinnedMetricSlugs === null ? null : (row.pinnedMetricSlugs as unknown as string[]),
      }
    : null;
}

/**
 * `pinnedMetricSlugs` 為 `undefined` 時**整個欄位都不出現在寫入裡**（既有值原封不動），理由見 port
 * 的說明。create 與 update 用同一個 spread：新列省略該欄位就落成 SQL NULL，也就是「還沒設定過」，
 * 那正是一個只存了 mode/visibleCardIds 的新使用者該有的狀態。
 *
 * 不寫 `pinnedMetricSlugs: null`——Prisma 的 nullable Json 欄位不接受裸 null，要用 `Prisma.DbNull`。
 * 省略欄位達到同樣效果而且不必 import Prisma 的 sentinel，兩處的寫法也才會一致。
 */
export async function upsertStockDetailPreferences(
  firebaseUid: string,
  mode: StockDetailPageMode,
  visibleCardIds: string[],
  pinnedMetricSlugs: string[] | undefined,
): Promise<StoredStockDetailPreferences> {
  const prisma = getPrismaClient();
  const row = await prisma.stockDetailPreferences.upsert({
    where: { firebaseUid },
    create: { firebaseUid, mode, visibleCardIds, ...(pinnedMetricSlugs === undefined ? {} : { pinnedMetricSlugs }) },
    update: { mode, visibleCardIds, ...(pinnedMetricSlugs === undefined ? {} : { pinnedMetricSlugs }) },
    select: { mode: true, visibleCardIds: true, pinnedMetricSlugs: true },
  });
  return {
    mode: row.mode,
    visibleCardIds: row.visibleCardIds as unknown as string[],
    pinnedMetricSlugs: row.pinnedMetricSlugs === null ? null : (row.pinnedMetricSlugs as unknown as string[]),
  };
}
