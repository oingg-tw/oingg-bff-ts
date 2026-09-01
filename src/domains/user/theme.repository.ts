import { getPrismaClient } from "../../adapters/neon/index.js";
import type { MarketColorConvention, ThemeAccentColor, ThemeMode, ThemePreferenceUpdate } from "./theme.types.js";

export interface ThemePreferenceRow {
  mode: ThemeMode | null;
  accentColor: ThemeAccentColor | null;
  marketColorConvention: MarketColorConvention | null;
  isFullWidth: boolean | null;
}

const SELECT_FIELDS = { mode: true, accentColor: true, marketColorConvention: true, isFullWidth: true } as const;

export async function findThemePreference(firebaseUid: string): Promise<ThemePreferenceRow | null> {
  const prisma = getPrismaClient();
  return prisma.userThemePreference.findUnique({
    where: { firebaseUid },
    select: SELECT_FIELDS,
  });
}

export async function upsertThemePreference(
  firebaseUid: string,
  update: ThemePreferenceUpdate,
): Promise<ThemePreferenceRow> {
  const prisma = getPrismaClient();
  return prisma.userThemePreference.upsert({
    where: { firebaseUid },
    create: { firebaseUid, ...update },
    update,
    select: SELECT_FIELDS,
  });
}
