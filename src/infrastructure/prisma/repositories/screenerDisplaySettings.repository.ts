import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { StoredScreenerDisplaySettings } from "@/application/ports/userPreferences.js";

export async function findDisplaySettings(firebaseUid: string): Promise<StoredScreenerDisplaySettings | null> {
  const prisma = getPrismaClient();
  return prisma.screenerDisplaySettings.findUnique({
    where: { firebaseUid },
    select: { showAsOfDate: true },
  });
}

export async function upsertDisplaySettings(
  firebaseUid: string,
  showAsOfDate: boolean,
): Promise<StoredScreenerDisplaySettings> {
  const prisma = getPrismaClient();
  return prisma.screenerDisplaySettings.upsert({
    where: { firebaseUid },
    create: { firebaseUid, showAsOfDate },
    update: { showAsOfDate },
    select: { showAsOfDate: true },
  });
}
