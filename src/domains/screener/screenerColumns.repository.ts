import { getPrismaClient } from "../../adapters/neon/index.js";

export interface ColumnPreferenceRow {
  metricKey: string;
  fieldKey: string;
  position: number;
}

export async function listColumnPreferences(firebaseUid: string): Promise<ColumnPreferenceRow[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.screenerColumnPreference.findMany({
    where: { firebaseUid },
    orderBy: { position: "asc" },
  });
  return rows.map((row) => ({ metricKey: row.metricKey, fieldKey: row.fieldKey, position: row.position }));
}

/** Replaces the user's full column set — this is a "set my columns to exactly this list" preference, not incremental. */
export async function replaceColumnPreferences(
  firebaseUid: string,
  columns: Array<{ metricKey: string; fieldKey: string }>,
): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    await tx.screenerColumnPreference.deleteMany({ where: { firebaseUid } });
    if (columns.length > 0) {
      await tx.screenerColumnPreference.createMany({
        data: columns.map((column, index) => ({
          firebaseUid,
          metricKey: column.metricKey,
          fieldKey: column.fieldKey,
          position: index,
        })),
      });
    }
  });
}
