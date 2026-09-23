import { Router } from "ultimate-express";
import { AppError } from "@/domain/appError.js";
import { requireAuth } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/application/auth/auth.types.js";
import { getEntitlementView } from "@/application/billing/billing.service.js";

export const billingRouter = Router();

billingRouter.use(requireAuth);

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
  res.json(await getEntitlementView(firebaseUid));
});
