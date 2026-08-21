import { getNeonPool } from "../../adapters/neon/index.js";
import type { WatchlistItem } from "./watchlist.types.js";

/** oingg-bff-ts's own database (NEON_DB_APP_URL) — this service owns this schema. */
const APP_DB = "app";

interface WatchlistRow {
  id: number;
  symbol: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT_COLUMNS = `id, symbol, note, created_at as "createdAt", updated_at as "updatedAt"`;

function toWatchlistItem(row: WatchlistRow): WatchlistItem {
  return {
    id: row.id,
    symbol: row.symbol,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function ensureWatchlistSchema(): Promise<void> {
  const pool = getNeonPool(APP_DB);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS watchlist_item (
      id SERIAL PRIMARY KEY,
      firebase_uid TEXT NOT NULL,
      symbol TEXT NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (firebase_uid, symbol)
    );

    CREATE INDEX IF NOT EXISTS watchlist_item_firebase_uid_idx ON watchlist_item (firebase_uid);
  `);
}

export async function listWatchlistItems(firebaseUid: string): Promise<WatchlistItem[]> {
  const pool = getNeonPool(APP_DB);
  const result = await pool.query<WatchlistRow>(
    `select ${SELECT_COLUMNS} from watchlist_item where firebase_uid = $1 order by created_at desc`,
    [firebaseUid],
  );
  return result.rows.map(toWatchlistItem);
}

export async function findWatchlistItem(firebaseUid: string, id: number): Promise<WatchlistItem | null> {
  const pool = getNeonPool(APP_DB);
  const result = await pool.query<WatchlistRow>(
    `select ${SELECT_COLUMNS} from watchlist_item where firebase_uid = $1 and id = $2`,
    [firebaseUid, id],
  );
  return result.rows[0] ? toWatchlistItem(result.rows[0]) : null;
}

export async function createWatchlistItem(
  firebaseUid: string,
  symbol: string,
  note: string | null,
): Promise<WatchlistItem> {
  const pool = getNeonPool(APP_DB);
  const result = await pool.query<WatchlistRow>(
    `insert into watchlist_item (firebase_uid, symbol, note)
     values ($1, $2, $3)
     returning ${SELECT_COLUMNS}`,
    [firebaseUid, symbol, note],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Insert into watchlist_item did not return a row");
  }
  return toWatchlistItem(row);
}

export async function updateWatchlistItemNote(
  firebaseUid: string,
  id: number,
  note: string | null,
): Promise<WatchlistItem | null> {
  const pool = getNeonPool(APP_DB);
  const result = await pool.query<WatchlistRow>(
    `update watchlist_item
     set note = $3, updated_at = now()
     where firebase_uid = $1 and id = $2
     returning ${SELECT_COLUMNS}`,
    [firebaseUid, id, note],
  );
  return result.rows[0] ? toWatchlistItem(result.rows[0]) : null;
}

export async function deleteWatchlistItem(firebaseUid: string, id: number): Promise<boolean> {
  const pool = getNeonPool(APP_DB);
  const result = await pool.query("delete from watchlist_item where firebase_uid = $1 and id = $2", [
    firebaseUid,
    id,
  ]);
  return (result.rowCount ?? 0) > 0;
}
