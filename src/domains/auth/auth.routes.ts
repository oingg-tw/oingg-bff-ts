import { Router } from "ultimate-express";
import { requireAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";

export const authRouter = Router();

authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});
