import { AppError } from "../../shared/errorHandler.js";
import { getStockQuote } from "../stock/index.js";
import {
  createWatchlistItem,
  deleteWatchlistItem,
  findWatchlistItem,
  listWatchlistItems,
  updateWatchlistItemNote,
} from "./watchlist.repository.js";
import type { WatchlistItem } from "./watchlist.types.js";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

async function assertSymbolExists(symbol: string): Promise<void> {
  const quote = await getStockQuote(symbol);
  if (!quote) {
    throw new AppError(`Unknown stock symbol "${symbol}"`, 404);
  }
}

export async function getWatchlist(firebaseUid: string): Promise<WatchlistItem[]> {
  return listWatchlistItems(firebaseUid);
}

export async function getWatchlistItemOrThrow(firebaseUid: string, id: number): Promise<WatchlistItem> {
  const item = await findWatchlistItem(firebaseUid, id);
  if (!item) {
    throw new AppError(`Watchlist item ${id} not found`, 404);
  }
  return item;
}

export async function addWatchlistItem(
  firebaseUid: string,
  symbol: string,
  note: string | null,
): Promise<WatchlistItem> {
  await assertSymbolExists(symbol);

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
  id: number,
  note: string | null,
): Promise<WatchlistItem> {
  const item = await updateWatchlistItemNote(firebaseUid, id, note);
  if (!item) {
    throw new AppError(`Watchlist item ${id} not found`, 404);
  }
  return item;
}

export async function removeWatchlistItem(firebaseUid: string, id: number): Promise<void> {
  const deleted = await deleteWatchlistItem(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Watchlist item ${id} not found`, 404);
  }
}
