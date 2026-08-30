import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../shared/errorHandler.js";
import { getStockQuote } from "../stock/index.js";
import {
  createHolding,
  deleteHolding,
  findHolding,
  listHoldings,
  updateHolding,
  type HoldingUpdate,
} from "./holdings.repository.js";
import type { Holding } from "./holdings.types.js";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION;
}

async function assertSymbolExists(symbol: string): Promise<void> {
  const quote = await getStockQuote(symbol);
  if (!quote) {
    throw new AppError(`Unknown stock symbol "${symbol}"`, 404);
  }
}

function assertValidQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new AppError('"quantity" must be a positive integer', 400);
  }
}

function assertValidAverageCost(averageCost: number): void {
  if (!Number.isFinite(averageCost) || averageCost < 0) {
    throw new AppError('"averageCost" must be a non-negative number', 400);
  }
}

export async function getHoldings(firebaseUid: string): Promise<Holding[]> {
  return listHoldings(firebaseUid);
}

export async function getHoldingOrThrow(firebaseUid: string, id: number): Promise<Holding> {
  const holding = await findHolding(firebaseUid, id);
  if (!holding) {
    throw new AppError(`Holding ${id} not found`, 404);
  }
  return holding;
}

export async function addHolding(
  firebaseUid: string,
  symbol: string,
  quantity: number,
  averageCost: number,
  note: string | null,
): Promise<Holding> {
  assertValidQuantity(quantity);
  assertValidAverageCost(averageCost);
  await assertSymbolExists(symbol);

  try {
    return await createHolding(firebaseUid, symbol, quantity, averageCost, note);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(`You already have a holding for "${symbol}" — edit it instead`, 409);
    }
    throw error;
  }
}

export async function editHolding(firebaseUid: string, id: number, update: HoldingUpdate): Promise<Holding> {
  if (update.quantity !== undefined) {
    assertValidQuantity(update.quantity);
  }
  if (update.averageCost !== undefined) {
    assertValidAverageCost(update.averageCost);
  }

  const holding = await updateHolding(firebaseUid, id, update);
  if (!holding) {
    throw new AppError(`Holding ${id} not found`, 404);
  }
  return holding;
}

export async function removeHolding(firebaseUid: string, id: number): Promise<void> {
  const deleted = await deleteHolding(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Holding ${id} not found`, 404);
  }
}
