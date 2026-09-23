import type { NextFunction, Response } from "ultimate-express";
import { AppError } from "@/domain/appError.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { getEntitlement, type EntitlementDeps } from "@/application/billing/entitlement.service.js";
import type { QuotaResource } from "@/application/billing/billing.types.js";
import { QUOTA_RESOURCE_LABELS, quotaLimitFor } from "@/application/billing/quota.js";

/** Machine-readable reason the frontend branches on to show an upgrade prompt rather than a generic error. */
export const QUOTA_EXCEEDED_CODE = "quota_exceeded";

/** 就是 getEntitlement 要的那些 port——額度檢查自己不存取任何資料，計數是呼叫端傳進來的函式。 */
export type QuotaMiddlewareDeps = EntitlementDeps;

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
export function enforceQuota(
  resource: QuotaResource,
  count: (firebaseUid: string) => Promise<number>,
  deps: QuotaMiddlewareDeps,
) {
  return async function quotaGuard(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
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

      const used = await count(firebaseUid);
      if (used >= limit) {
        next(
          new AppError(
            `Your plan allows ${limit} ${QUOTA_RESOURCE_LABELS[resource]}; you're using ${used}.`,
            403,
            { resource, limit, used, tier: entitlement.tier },
            QUOTA_EXCEEDED_CODE,
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
