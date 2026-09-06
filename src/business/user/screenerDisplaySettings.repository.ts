import { getPrismaClient } from "@/adapters/neon/index.js";

export interface ScreenerDisplaySettingsRow {
  showAsOfDate: boolean | null;
}

export async function findDisplaySettings(firebaseUid: string): Promise<ScreenerDisplaySettingsRow | null> {
  const prisma = getPrismaClient();
  return prisma.screenerDisplaySettings.findUnique({
    where: { firebaseUid },
    select: { showAsOfDate: true },
  });
}

export async function upsertDisplaySettings(
  firebaseUid: string,
  showAsOfDate: boolean,
): Promise<ScreenerDisplaySettingsRow> {
  const prisma = getPrismaClient();
  return prisma.screenerDisplaySettings.upsert({
    where: { firebaseUid },
    create: { firebaseUid, showAsOfDate },
    update: { showAsOfDate },
    select: { showAsOfDate: true },
  });
}
