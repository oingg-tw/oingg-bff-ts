import { Router } from "ultimate-express";
import { requireAuth } from "./auth.middleware.js";
import type { AuthenticatedRequest } from "./auth.types.js";

export const authRouter = Router();

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: 回傳目前登入者的解碼後 Firebase token
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 解碼後的 Firebase user token。
 *       401:
 *         description: 缺少或無效的 Authorization header / token。
 */
authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});
