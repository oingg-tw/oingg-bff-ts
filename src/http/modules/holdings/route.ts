import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { dateQueryParam, parseBody } from "@/shared/validation.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { getHoldings, getRealizedProfitLoss, removeHoldingSymbol } from "@/application/holdings/holdings.service.js";
import type { HoldingsDeps } from "@/application/holdings/holdings.service.js";
import {
  getPortfolioPerformance,
  type HoldingsPerformanceDeps,
} from "@/application/holdings/holdingsPerformance.service.js";

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

/** /realized 與 /performance 共用：兩個都是選填的 YYYY-MM-DD，而且 from 不得晚於 to。 */
export const dateRangeQuerySchema = z
  .object({ from: dateQueryParam("from"), to: dateQueryParam("to") })
  // path 掛在 from 上：parseBody 對沒有 path 的錯誤標 "(body)"，而這是 query 參數，那個標籤會誤導人。
  .refine((q) => !q.from || !q.to || q.from <= q.to, { error: '"from" must not be after "to"', path: ["from"] });

/**
 * **2026-10-05：持股從一張可寫的表變成交易紀錄的唯讀投影。** `POST`、`PATCH`、`GET /:id` 整組移除——
 * 持股現在沒有 id 可以當鍵（舊表的 unique constraint 本來就是 (firebaseUid, symbol)），要新增或修改持股
 * 就是新增或修改交易。期初部位記成一筆日期最早的 BUY。
 *
 * 也因此這個 router 不再需要 `assertSymbolExists`：唯一剩下的寫入是刪除，而刪一個不存在的代號本來就
 * 因為「你在這個代號底下沒有交易」而回 404，不需要先問上游那個代號是不是真的。
 */
export function createHoldingsRouter(deps: HoldingsDeps & HoldingsPerformanceDeps & AuthMiddlewareDeps): Router {
  const holdingsRouter = Router();
  holdingsRouter.use(createRequireAuth(deps));

  holdingsRouter.get("/", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const holdings = await getHoldings(firebaseUid, deps);
    res.json({ holdings });
  });

  holdingsRouter.get("/realized", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const { from, to } = parseBody(dateRangeQuerySchema, req.query);
    res.json(await getRealizedProfitLoss(firebaseUid, from, to, deps));
  });

  holdingsRouter.get("/performance", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const { from, to } = parseBody(dateRangeQuerySchema, req.query);
    res.json(await getPortfolioPerformance(firebaseUid, from, to, deps));
  });

  holdingsRouter.delete("/:symbol", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const symbol = (req.params.symbol ?? "").trim();
    if (!symbol) {
      throw new AppError('"symbol" is required', 400);
    }
    await removeHoldingSymbol(firebaseUid, symbol, deps);
    res.status(204).end();
  });

  return holdingsRouter;
}
