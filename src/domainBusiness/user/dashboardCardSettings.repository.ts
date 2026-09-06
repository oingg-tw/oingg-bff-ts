import { getPrismaClient } from "@/adapters/neon/index.js";

export interface DashboardCardSettingsRow {
  visibleCardIds: string[];
}

export async function findDashboardCardSettings(firebaseUid: string): Promise<DashboardCardSettingsRow | null> {
  const prisma = getPrismaClient();
  const row = await prisma.dashboardCardSettings.findUnique({
    where: { firebaseUid },
    select: { visibleCardIds: true },
  });
  return row ? { visibleCardIds: row.visibleCardIds as unknown as string[] } : null;
}

export async function upsertDashboardCardSettings(
  firebaseUid: string,
  visibleCardIds: string[],
): Promise<DashboardCardSettingsRow> {
  const prisma = getPrismaClient();
  const row = await prisma.dashboardCardSettings.upsert({
    where: { firebaseUid },
    create: { firebaseUid, visibleCardIds },
    update: { visibleCardIds },
    select: { visibleCardIds: true },
  });
  return { visibleCardIds: row.visibleCardIds as unknown as string[] };
}
