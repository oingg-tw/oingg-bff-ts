import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { HoldingColumn } from "@/application/user/holdingColumns.types.js";

export async function findHoldingColumns(firebaseUid: string): Promise<HoldingColumn[] | null> {
  const prisma = getPrismaClient();
  const row = await prisma.holdingColumnPreferences.findUnique({ where: { firebaseUid }, select: { columns: true } });
  // JSON 欄位：寫入時已經過 route 的 zod 驗證，這裡的轉型只是把 Prisma 的 JsonValue 收斂成宣告的形狀。
  return row ? (row.columns as unknown as HoldingColumn[]) : null;
}

export async function upsertHoldingColumns(firebaseUid: string, columns: HoldingColumn[]): Promise<HoldingColumn[]> {
  const prisma = getPrismaClient();
  const json = columns as unknown as object[];
  const row = await prisma.holdingColumnPreferences.upsert({
    where: { firebaseUid },
    create: { firebaseUid, columns: json },
    update: { columns: json },
    select: { columns: true },
  });
  return row.columns as unknown as HoldingColumn[];
}
