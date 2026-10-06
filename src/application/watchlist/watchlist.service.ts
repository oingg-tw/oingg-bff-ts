import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import type { WatchlistItem } from "@/application/watchlist/watchlist.types.js";

export type WatchlistDeps = Pick<AppDeps, "watchlist">;

export async function getWatchlist(firebaseUid: string, deps: WatchlistDeps): Promise<WatchlistItem[]> {
  return deps.watchlist.list(firebaseUid);
}

export async function getWatchlistItemOrThrow(
  firebaseUid: string,
  id: string,
  deps: WatchlistDeps,
): Promise<WatchlistItem> {
  const item = await deps.watchlist.find(firebaseUid, id);
  if (!item) {
    throw new AppError(`Watchlist item ${id} not found`, 404);
  }
  return item;
}

/**
 * Symbol existence is validated by the caller (the route, via the stock gateway) before this runs —
 * this slice has no reason to reach into the proxy layer's live quote data itself.
 *
 * The duplicate case arrives as a value from the port rather than as a thrown Prisma error. Before the
 * ports refactor this function caught `Prisma.PrismaClientKnownRequestError` and compared `error.code`
 * to "P2002", which quietly tied the 409 to one specific database driver: swap the driver and the catch
 * stops matching, turning a clean 409 into a 500 with no test failing.
 */
export async function addWatchlistItem(
  firebaseUid: string,
  symbol: string,
  note: string | null,
  deps: WatchlistDeps,
): Promise<WatchlistItem> {
  const result = await deps.watchlist.create(firebaseUid, symbol, note);
  if (!result.ok) {
    throw new AppError(`"${symbol}" is already in your watchlist`, 409);
  }
  return result.item;
}

export async function editWatchlistItemNote(
  firebaseUid: string,
  id: string,
  note: string | null,
  deps: WatchlistDeps,
): Promise<WatchlistItem> {
  const item = await deps.watchlist.updateNote(firebaseUid, id, note);
  if (!item) {
    throw new AppError(`Watchlist item ${id} not found`, 404);
  }
  return item;
}

/**
 * 自訂排序（2026-10-06）：一次送整份順序。400 讓前端知道它手上的清單已經過期（例如另一個分頁剛加了
 * 一檔），重新 GET 再排。
 */
export async function reorderWatchlist(firebaseUid: string, orderedIds: string[], deps: WatchlistDeps): Promise<WatchlistItem[]> {
  const items = await deps.watchlist.reorder(firebaseUid, orderedIds);
  if (!items) {
    throw new AppError('"ids" must list every item in your watchlist exactly once, in the new order', 400);
  }
  return items;
}

export async function removeWatchlistItem(firebaseUid: string, id: string, deps: WatchlistDeps): Promise<void> {
  const deleted = await deps.watchlist.remove(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Watchlist item ${id} not found`, 404);
  }
}
