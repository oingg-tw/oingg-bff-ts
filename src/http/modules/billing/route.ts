import { Router } from "ultimate-express";
import { AppError } from "@/domain/appError.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { getEntitlementView, getPlans, type BillingDeps } from "@/application/billing/billing.service.js";

/** 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。 */
export function createBillingRouter(deps: BillingDeps & AuthMiddlewareDeps): Router {
  const billingRouter = Router();

  // 公開，掛在登入驗證之前：未登入的訪客也要看得到方案比較表。只有額度常數，沒有任何使用者資料。
  billingRouter.get("/plans", (_req, res) => {
    res.json(getPlans());
  });

  billingRouter.use(createRequireAuth(deps));

  /**
   * Read-only, and (with the public /plans above) the only billing endpoint that exists on purpose. Subscription rows will be written
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
