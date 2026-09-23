import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { StoredThemePreference } from "@/application/ports/userPreferences.js";
import type { ThemePreferenceUpdate } from "@/application/user/theme.types.js";

const SELECT_FIELDS = { mode: true, accentColor: true, marketColorConvention: true, isFullWidth: true } as const;

export async function findThemePreference(firebaseUid: string): Promise<StoredThemePreference | null> {
  const prisma = getPrismaClient();
  return prisma.userThemePreference.findUnique({
    where: { firebaseUid },
    select: SELECT_FIELDS,
  });
}

export async function upsertThemePreference(
  firebaseUid: string,
  update: ThemePreferenceUpdate,
): Promise<StoredThemePreference> {
  const prisma = getPrismaClient();
  return prisma.userThemePreference.upsert({
    where: { firebaseUid },
    create: { firebaseUid, ...update },
    update,
    select: SELECT_FIELDS,
  });
}
