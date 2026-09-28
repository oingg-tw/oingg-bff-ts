import { Router, type NextFunction, type Response } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import { enforceQuota, type QuotaMiddlewareDeps } from "@/http/middleware/quota.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { assertSymbolExists, type StockProxyDeps } from "@/application/proxy/stock/stock.service.js";
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
 * 已經在清單裡的 symbol 直接回 409，**在額度 guard 之前**——理由見 quota.middleware.ts。
 *
 * body 會被解析兩次（這裡與 handler 各一次）。那是刻意的：讓這支 guard 不依賴 handler 有沒有先跑過，
 * 代價只是一次 zod 解析。順帶的好處是重複請求不會再去打 analysis-ts 確認代號存在（assertSymbolExists
 * 在 handler 裡），少一次跨服務往返。
 */
function rejectExistingSymbol(deps: WatchlistDeps) {
  return async function existingSymbolGuard(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      const firebaseUid = requireUser(req);
      const body = parseBody(addWatchlistItemSchema, req.body);
      if (await deps.watchlist.findBySymbol(firebaseUid, body.symbol)) {
        next(new AppError(`"${body.symbol}" is already in your watchlist`, 409));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。
 * 這是 http 層不再依賴 infrastructure 的關鍵——它只認得 application 匯出的型別。
 */
export function createWatchlistRouter(deps: WatchlistDeps & StockProxyDeps & AuthMiddlewareDeps & QuotaMiddlewareDeps): Router {
  const watchlistRouter = Router();
  watchlistRouter.use(createRequireAuth(deps));

  watchlistRouter.get("/", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const items = await getWatchlist(firebaseUid, deps);
    res.json({ items });
  });

  // 只擋新增：額度用完的人（例如反向試用剛結束）保留已經加進去的每一檔，只是不能再加——降級是唯讀不是
  // 刪除，理由見 billing/quota.ts。跟 POST /screener/presets 同一個寫法。
  //
  // rejectExistingSymbol 必須排在 enforceQuota **之前**，理由見 quota.middleware.ts 的掛載順序說明。
  watchlistRouter.post("/", rejectExistingSymbol(deps), enforceQuota("watchlistItems", (uid) => deps.watchlist.count(uid), deps), async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(addWatchlistItemSchema, req.body);

    await assertSymbolExists(body.symbol, deps);
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
