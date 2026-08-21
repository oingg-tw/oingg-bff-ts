import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import {
  addWatchlistItem,
  editWatchlistItemNote,
  getWatchlist,
  getWatchlistItemOrThrow,
  removeWatchlistItem,
} from "./watchlist.service.js";

export const watchlistRouter = Router();

watchlistRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(`Invalid watchlist item id "${raw}"`, 400);
  }
  return id;
}

function parseNote(body: unknown): string | null {
  const note = (body as { note?: unknown } | null)?.note;
  if (note === undefined || note === null) {
    return null;
  }
  if (typeof note !== "string") {
    throw new AppError('"note" must be a string', 400);
  }
  return note;
}

watchlistRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const items = await getWatchlist(firebaseUid);
  res.json({ items });
});

watchlistRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const symbol = (req.body as { symbol?: unknown } | null)?.symbol;

  if (typeof symbol !== "string" || symbol.trim() === "") {
    throw new AppError('"symbol" is required', 400);
  }

  const item = await addWatchlistItem(firebaseUid, symbol.trim(), parseNote(req.body));
  res.status(201).json({ item });
});

watchlistRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const item = await getWatchlistItemOrThrow(firebaseUid, id);
  res.json({ item });
});

watchlistRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const item = await editWatchlistItemNote(firebaseUid, id, parseNote(req.body));
  res.json({ item });
});

watchlistRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removeWatchlistItem(firebaseUid, id);
  res.status(204).end();
});
