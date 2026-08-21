import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { getUserByFirebaseUidOrThrow } from "./user.service.js";

export const userRouter = Router();

userRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  const profile = await getUserByFirebaseUidOrThrow(req.user.uid);
  res.json({ user: profile });
});
