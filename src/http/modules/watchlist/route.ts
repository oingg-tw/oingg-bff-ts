import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { assertSymbolExists } from "@/application/proxy/stock/index.js";
import type { WatchlistDeps } from "@/application/watchlist/watchlist.service.js";
import {
  addWatchlistItem,
  editWatchlistItemNote,
  getWatchlist,
  getWatchlistItemOrThrow,
  removeWatchlistItem,
} from "@/application/watchlist/watchlist.service.js";


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

/**
 * 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。
 * 這是 http 層不再依賴 infrastructure 的關鍵——它只認得 application 匯出的型別。
 */
export function createWatchlistRouter(deps: WatchlistDeps & AuthMiddlewareDeps): Router {
  const watchlistRouter = Router();
  watchlistRouter.use(createRequireAuth(deps));

  watchlistRouter.get("/", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const items = await getWatchlist(firebaseUid, deps);
    res.json({ items });
  });

  watchlistRouter.post("/", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(addWatchlistItemSchema, req.body);

    await assertSymbolExists(body.symbol);
    const item = await addWatchlistItem(firebaseUid, body.symbol, body.note ?? null, deps);
    res.status(201).json({ item });
  });

  watchlistRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    const item = await getWatchlistItemOrThrow(firebaseUid, id, deps);
    res.json({ item });
  });

  watchlistRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    const body = parseBody(updateWatchlistItemSchema, req.body ?? {});
    const item = await editWatchlistItemNote(firebaseUid, id, body.note ?? null, deps);
    res.json({ item });
  });

  watchlistRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    await removeWatchlistItem(firebaseUid, id, deps);
    res.status(204).end();
  });

  return watchlistRouter;
}
