import type { NextFunction, Response } from "ultimate-express";
import { AppError } from "@/domain/appError.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { holdUserWriteLock, type UserWriteLockDeps } from "@/http/middleware/userWriteLock.middleware.js";
import { getEntitlement, type EntitlementDeps } from "@/application/billing/entitlement.service.js";
import type { QuotaResource } from "@/application/billing/billing.types.js";
import { QUOTA_EXCEEDED_CODE, QUOTA_RESOURCE_LABELS, quotaLimitFor } from "@/application/billing/quota.js";

export { QUOTA_EXCEEDED_CODE };

/** 就是 getEntitlement 要的那些 port——額度檢查自己不存取任何資料，計數是呼叫端傳進來的函式。 */
export type QuotaMiddlewareDeps = EntitlementDeps & UserWriteLockDeps;

/**
 * Blocks *creating* one more of a metered resource once the caller's tier is full.
 *
 * Two deliberate properties:
 *
 * 1. **It only ever blocks creation.** Nothing here deletes, hides or truncates anything the user
 *    already has — a user who drops to FREE holding 30 watchlist items keeps all 30 and simply can't
 *    add a 31st. That's both the product rule (destroying what someone built kills the endowment
 *    effect the funnel runs on) and the compliance rule (what a downgrade removes must be breadth or
 *    efficiency, never analysis content).
 *
 * 2. **The counter is injected, not imported.** Billing stays free of dependencies on the domains it
 *    meters — each route passes its own count function — which keeps the tier out of every service's
 *    reach by construction. A stock-detail handler can't accidentally branch on entitlement because it
 *    never receives it.
 *
 * The entitlement ports now arrive the same way, as a third argument, instead of this file importing
 * the service's own dependencies. That's the same principle as (2) applied one level up: this factory
 * already existed to let each route supply its own counter, so letting it supply the ports too keeps
 * "who decides the implementation" in the composition root rather than at the top of this module.
 *
 * The 403's machine-readable part is just `code`. The numbers behind "you've used 3 of 3" come from
 * GET /billing/entitlement, which returns the caller's whole quota table — duplicating limits into
 * every error body would give the frontend two sources for one fact, and they'd drift. The message
 * still spells the numbers out for logs and for any caller that shows it raw.
 */
/**
 * **掛載順序有一條規則：會被 409 拒絕的請求必須在這支 guard 之前就被回答。**
 *
 * 這支 middleware 只知道「你用了幾個」，不知道這次請求會不會真的新增一列。所以在額度剛好用滿的狀態下，
 * 一筆**不會新增任何列**的重複請求也會被它判成 403 quota_exceeded——而那是錯的兩次：使用者被告知要升級
 * 才能重新加入一個他已經擁有的東西，而下游收到 403 之後會把樂觀加入的項目收回，於是畫面上少掉一個合法
 * 項目。2026-09-29 在 watchlist 上實測到這個行為（滿 10 檔時重複加入既有股票回 403 而不是 409）。
 *
 * 所以 watchlist 與 columnPresets 的建立路由都在這支 guard **之前**放一個自然鍵查詢（findBySymbol /
 * findByName），重複就先回 409。screenerPresets 不需要：它的名稱是自動產生的（未命名、未命名 2…），
 * 建立時不存在「重複」這個結果。
 *
 * 這些前置查詢**不是**唯一性的保證——真正的保證是 DB 的 unique 約束，而 create() 仍然會把 P2002 翻譯成
 * `{ ok: false, reason: "duplicate" }`。前置查詢只負責讓兩個錯誤的**先後順序**是對的。
 */
export function enforceQuota(
  resource: QuotaResource,
  count: (firebaseUid: string) => Promise<number>,
  deps: QuotaMiddlewareDeps,
) {
  return async function quotaGuard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const firebaseUid = req.user?.uid;
      if (!firebaseUid) {
        // Only reachable if this is mounted without requireAuth in front of it.
        next(new AppError("Authenticated request is missing decoded user", 401));
        return;
      }

      const entitlement = await getEntitlement(firebaseUid, new Date(), deps);
      const limit = quotaLimitFor(resource, entitlement.tier);
      if (limit === null) {
        next();
        return;
      }

      // 先拿這個使用者的寫入鎖再算：count 跟後面 handler 的 insert 之間沒有鎖的話，並發的建立全部看到同一個
      // used，全部放行（2026-10-11 壓測：FREE 上限 3，10 個並發建立全部成功）。鎖到回應送出才放。
      const release = await holdUserWriteLock(firebaseUid, res, deps);
      const used = await count(firebaseUid);
      if (used >= limit) {
        release();
        next(
          new AppError(
            `Your plan allows ${limit} ${QUOTA_RESOURCE_LABELS[resource]}; you're using ${used}.`,
            403,
            undefined,
            QUOTA_EXCEEDED_CODE,
            { resource, limit, used, tier: entitlement.tier },
          ),
        );
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
