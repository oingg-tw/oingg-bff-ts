import { Router } from "ultimate-express";
import { AppError } from "@/domain/appError.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { getEntitlementView, type BillingDeps } from "@/application/billing/billing.service.js";

/** 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。 */
export function createBillingRouter(deps: BillingDeps & AuthMiddlewareDeps): Router {
  const billingRouter = Router();

  billingRouter.use(createRequireAuth(deps));

  /**
   * Read-only, and the only billing endpoint that exists on purpose. Subscription rows will be written
   * exclusively by the payment webhook (Phase 1) — there is no user-facing write path here, because one
   * would let a caller grant themselves a subscription.
   */
  billingRouter.get("/entitlement", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = req.user?.uid;
    if (!firebaseUid) {
      throw new AppError("Authenticated request is missing decoded user", 401);
    }
    res.json(await getEntitlementView(firebaseUid, deps));
  });

  return billingRouter;
}
