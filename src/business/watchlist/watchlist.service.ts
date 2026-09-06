import { Prisma } from "@/generated/prisma/client.js";
import { AppError } from "@/shared/errorHandler.js";
import {
  createWatchlistItem,
  deleteWatchlistItem,
  findWatchlistItem,
  listWatchlistItems,
  updateWatchlistItemNote,
} from "@/business/watchlist/watchlist.repository.js";
import type { WatchlistItem } from "@/business/watchlist/watchlist.types.js";

/** Prisma's error code for a unique constraint violation (wraps Postgres's own 23505). */
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION;
}

export async function getWatchlist(firebaseUid: string): Promise<WatchlistItem[]> {
  return listWatchlistItems(firebaseUid);
}

export async function getWatchlistItemOrThrow(firebaseUid: string, id: string): Promise<WatchlistItem> {
  const item = await findWatchlistItem(firebaseUid, id);
  if (!item) {
    throw new AppError(`Watchlist item ${id} not found`, 404);
  }
  return item;
}

/**
 * Symbol existence is validated by the caller (watchlist.routes.ts, via bff-ts's stock.assertSymbolExists)
 * before this is invoked — this domain's own service has no reason to reach across into the stock
 * pass-through's live quote data itself.
 */
export async function addWatchlistItem(
  firebaseUid: string,
  symbol: string,
  note: string | null,
): Promise<WatchlistItem> {
  try {
    return await createWatchlistItem(firebaseUid, symbol, note);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(`"${symbol}" is already in your watchlist`, 409);
    }
    throw error;
  }
}

export async function editWatchlistItemNote(
  firebaseUid: string,
  id: string,
  note: string | null,
): Promise<WatchlistItem> {
  const item = await updateWatchlistItemNote(firebaseUid, id, note);
  if (!item) {
    throw new AppError(`Watchlist item ${id} not found`, 404);
  }
  return item;
}

export async function removeWatchlistItem(firebaseUid: string, id: string): Promise<void> {
  const deleted = await deleteWatchlistItem(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Watchlist item ${id} not found`, 404);
  }
}
