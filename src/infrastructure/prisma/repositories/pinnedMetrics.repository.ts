import { getPrismaClient } from "@/infrastructure/prisma/index.js";

/** null＝這個帳號從沒存過釘選（沒有這一列），前端套自己的預設；[]＝使用者把釘選全取消了。兩者不同。 */
export async function findPinnedMetrics(firebaseUid: string): Promise<string[] | null> {
  const prisma = getPrismaClient();
  const row = await prisma.pinnedMetricPreferences.findUnique({ where: { firebaseUid }, select: { slugs: true } });
  // JSON 欄位：寫入時已經過 route 的 zod 驗證，這裡的轉型只是把 Prisma 的 JsonValue 收斂成宣告的形狀。
  return row ? (row.slugs as string[]) : null;
}

export async function upsertPinnedMetrics(firebaseUid: string, slugs: string[]): Promise<string[]> {
  const prisma = getPrismaClient();
  const row = await prisma.pinnedMetricPreferences.upsert({
    where: { firebaseUid },
    create: { firebaseUid, slugs },
    update: { slugs },
    select: { slugs: true },
  });
  return row.slugs as string[];
}
