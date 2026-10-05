import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import type { Holding, HoldingUpdate } from "@/application/holdings/holdings.types.js";

export type HoldingsDeps = Pick<AppDeps, "holdings">;

/**
 * 上界對齊**資料庫欄位**而不是某個猜出來的業務上限：`quantity` 是 `Int`（最大 2,147,483,647），
 * `averageCost` 是 `Decimal(18,4)`（整數部分 14 位）。少了上界的話，一個合法的正整數也能溢出欄位，
 * 而那會變成 500 而不是 400——錯在呼叫端卻看起來像我們壞了。2026-10-05 由 web-nuxt 指出。
 *
 * 整數與正數的檢查本來就有（所以「完全沒驗」是誤會，缺的只有上界）。
 */
const MAX_INT32 = 2_147_483_647;
/**
 * `Decimal(18,4)` 的真正上限是 99999999999999.9999，但那個字面值在 double 裡**不可精確表示**
 * （14 位整數加 4 位小數超過 53 bit 尾數，oxlint 的 no-loss-of-precision 抓到的就是這個）。
 * 所以改用可精確表示的 1e14 當**開區間**上界：小於 1e14 的值整數部分一定在 14 位內，必然放得下。
 * 代價是多擋掉 [99999999999999.9999, 1e14) 這個寬度 0.0001 的縫，那個範圍沒有真實用途。
 */
const DECIMAL_18_4_EXCLUSIVE_MAX = 1e14;

function assertValidQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_INT32) {
    throw new AppError(`"quantity" must be a positive integer no greater than ${MAX_INT32}`, 400);
  }
}

function assertValidAverageCost(averageCost: number): void {
  if (!Number.isFinite(averageCost) || averageCost < 0 || averageCost >= DECIMAL_18_4_EXCLUSIVE_MAX) {
    throw new AppError('"averageCost" must be a non-negative number within the column precision', 400);
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
