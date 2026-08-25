import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { getUserByFirebaseUidOrThrow } from "./user.service.js";

export const userRouter = Router();

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: 查詢目前登入使用者的 user profile
 *     description: 依 Firebase token 的 uid 查詢 NEON_DB_MOPS_URL 中的 users 表（見 user.service.ts）。
 *     tags:
 *       - User
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: user profile。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 *       404:
 *         description: 找不到對應此 Firebase uid 的使用者。
 */
userRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  const profile = await getUserByFirebaseUidOrThrow(req.user.uid);
  res.json({ user: profile });
});
