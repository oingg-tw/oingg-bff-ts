import { getPrismaClient } from "@/adapters/neon/index.js";
import type { PreferredStocksColumnPreset } from "@/domainBusiness/user/preferredStocksPreferences.types.js";

export interface PreferredStocksPreferencesRow {
  columnPresetId: PreferredStocksColumnPreset;
  columnOrder: string[];
}

export async function findPreferredStocksPreferences(
  firebaseUid: string,
): Promise<PreferredStocksPreferencesRow | null> {
  const prisma = getPrismaClient();
  const row = await prisma.preferredStocksPreferences.findUnique({
    where: { firebaseUid },
    select: { columnPresetId: true, columnOrder: true },
  });
  return row ? { columnPresetId: row.columnPresetId, columnOrder: row.columnOrder as unknown as string[] } : null;
}

export async function upsertPreferredStocksPreferences(
  firebaseUid: string,
  columnPresetId: PreferredStocksColumnPreset,
  columnOrder: string[],
): Promise<PreferredStocksPreferencesRow> {
  const prisma = getPrismaClient();
  const row = await prisma.preferredStocksPreferences.upsert({
    where: { firebaseUid },
    create: { firebaseUid, columnPresetId, columnOrder },
    update: { columnPresetId, columnOrder },
    select: { columnPresetId: true, columnOrder: true },
  });
  return { columnPresetId: row.columnPresetId, columnOrder: row.columnOrder as unknown as string[] };
}
