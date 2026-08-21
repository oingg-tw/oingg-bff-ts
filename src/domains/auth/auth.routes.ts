import { Router } from "ultimate-express";
import { asyncHandler } from "../../shared/asyncHandler.js";
import { requireAuth } from "./auth.middleware.js";
import type { AuthenticatedRequest } from "./auth.types.js";

export const authRouter = Router();

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  }),
);
