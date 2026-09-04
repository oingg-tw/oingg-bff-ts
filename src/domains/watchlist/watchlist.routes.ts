import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { requireAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import {
  addWatchlistItem,
  editWatchlistItemNote,
  getWatchlist,
  getWatchlistItemOrThrow,
  removeWatchlistItem,
} from "@/domains/watchlist/watchlist.service.js";

export const watchlistRouter = Router();

watchlistRouter.use(requireAuth);

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): string {
  return parseUuidParam(raw, "watchlist item");
}

export const addWatchlistItemSchema = z.object({
  symbol: z.string().trim().min(1, '"symbol" is required'),
  note: z.string().nullish(),
});

export const updateWatchlistItemSchema = z.object({
  note: z.string().nullish(),
});

watchlistRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const items = await getWatchlist(firebaseUid);
  res.json({ items });
});

watchlistRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(addWatchlistItemSchema, req.body);

  const item = await addWatchlistItem(firebaseUid, body.symbol, body.note ?? null);
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
  const body = parseBody(updateWatchlistItemSchema, req.body ?? {});
  const item = await editWatchlistItemNote(firebaseUid, id, body.note ?? null);
  res.json({ item });
});

watchlistRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removeWatchlistItem(firebaseUid, id);
  res.status(204).end();
});
