import { getPrismaClient } from "@/adapters/neon/index.js";
import type { Holding as HoldingRow } from "@/generated/prisma/client.js";
import type { Holding } from "@/domains/holdings/holdings.types.js";

function toHolding(row: HoldingRow): Holding {
  return {
    id: row.id,
    symbol: row.symbol,
    quantity: row.quantity,
    averageCost: row.averageCost.toString(),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listHoldings(firebaseUid: string): Promise<Holding[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.holding.findMany({
    where: { firebaseUid },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toHolding);
}

export async function findHolding(firebaseUid: string, id: string): Promise<Holding | null> {
  const prisma = getPrismaClient();
  const row = await prisma.holding.findFirst({ where: { firebaseUid, id } });
  return row ? toHolding(row) : null;
}

export async function createHolding(
  firebaseUid: string,
  symbol: string,
  quantity: number,
  averageCost: number,
  note: string | null,
): Promise<Holding> {
  const prisma = getPrismaClient();
  const row = await prisma.holding.create({ data: { firebaseUid, symbol, quantity, averageCost, note } });
  return toHolding(row);
}

export interface HoldingUpdate {
  quantity?: number;
  averageCost?: number;
  note?: string | null;
}

export async function updateHolding(
  firebaseUid: string,
  id: string,
  update: HoldingUpdate,
): Promise<Holding | null> {
  const prisma = getPrismaClient();
  const result = await prisma.holding.updateMany({ where: { firebaseUid, id }, data: update });
  if (result.count === 0) {
    return null;
  }
  return findHolding(firebaseUid, id);
}

export async function deleteHolding(firebaseUid: string, id: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const result = await prisma.holding.deleteMany({ where: { firebaseUid, id } });
  return result.count > 0;
}
