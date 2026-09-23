import { Prisma } from "@/generated/prisma/client.js";
import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { Holding as HoldingRow } from "@/generated/prisma/client.js";
import type { Holding, HoldingUpdate } from "@/application/holdings/holdings.types.js";
import type { HoldingsPort } from "@/application/ports/holdings.js";

/** Prisma's code for a unique constraint violation (wraps Postgres's own 23505). */
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

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

/**
 * HoldingsPort 的 Prisma 實作。
 *
 * create 在這裡把 Prisma 的 unique violation（P2002，包住 Postgres 的 23505）翻譯成
 * `{ ok: false, reason: "duplicate" }`——重構前這個 catch 住在 service 層，等於 application 知道自己被
 * Prisma 實作；換掉驅動時那個 catch 會安靜地失效，409 變 500 而且沒有測試會紅。翻譯是這一層的責任。
 */
export const prismaHoldings: HoldingsPort = {
  list: listHoldings,
  find: findHolding,
  async create(firebaseUid, symbol, quantity, averageCost, note) {
    try {
      return { ok: true, holding: await createHolding(firebaseUid, symbol, quantity, averageCost, note) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
        return { ok: false, reason: "duplicate" };
      }
      throw error;
    }
  },
  update: updateHolding,
  remove: deleteHolding,
};
