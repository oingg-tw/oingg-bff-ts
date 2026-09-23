import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import type { Holding, HoldingUpdate } from "@/application/holdings/holdings.types.js";

export type HoldingsDeps = Pick<AppDeps, "holdings">;

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

export async function getHoldings(firebaseUid: string, deps: HoldingsDeps): Promise<Holding[]> {
  return deps.holdings.list(firebaseUid);
}

export async function getHoldingOrThrow(firebaseUid: string, id: string, deps: HoldingsDeps): Promise<Holding> {
  const holding = await deps.holdings.find(firebaseUid, id);
  if (!holding) {
    throw new AppError(`Holding ${id} not found`, 404);
  }
  return holding;
}

/**
 * Symbol existence is validated by the caller (holdings.routes.ts, via bff-ts's stock.assertSymbolExists)
 * before this is invoked — this domain's own service has no reason to reach across into the stock
 * pass-through's live quote data itself.
 *
 * The duplicate case arrives as a value from the port rather than as a thrown Prisma error. Before the
 * ports refactor this function caught `Prisma.PrismaClientKnownRequestError` and compared `error.code`
 * to "P2002", which quietly tied the 409 to one specific database driver: swap the driver and the catch
 * stops matching, turning a clean 409 into a 500 with no test failing.
 */
export async function addHolding(
  firebaseUid: string,
  symbol: string,
  quantity: number,
  averageCost: number,
  note: string | null,
  deps: HoldingsDeps,
): Promise<Holding> {
  assertValidQuantity(quantity);
  assertValidAverageCost(averageCost);

  const result = await deps.holdings.create(firebaseUid, symbol, quantity, averageCost, note);
  if (!result.ok) {
    throw new AppError(`You already have a holding for "${symbol}" — edit it instead`, 409);
  }
  return result.holding;
}

export async function editHolding(
  firebaseUid: string,
  id: string,
  update: HoldingUpdate,
  deps: HoldingsDeps,
): Promise<Holding> {
  if (update.quantity !== undefined) {
    assertValidQuantity(update.quantity);
  }
  if (update.averageCost !== undefined) {
    assertValidAverageCost(update.averageCost);
  }

  const holding = await deps.holdings.update(firebaseUid, id, update);
  if (!holding) {
    throw new AppError(`Holding ${id} not found`, 404);
  }
  return holding;
}

export async function removeHolding(firebaseUid: string, id: string, deps: HoldingsDeps): Promise<void> {
  const deleted = await deps.holdings.remove(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Holding ${id} not found`, 404);
  }
}
