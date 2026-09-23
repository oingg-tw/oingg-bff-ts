import { Router } from "ultimate-express";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";

/**
 * 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。
 *
 * 這支路由自己沒有任何 use case，唯一的依賴就是驗證本身——它的作用是把「你這張 token 解出來長什麼樣」
 * 原樣回給呼叫端（除錯用），所以 req.user 是整包序列化出去的，不是挑欄位重組。
 */
export function createAuthRouter(deps: AuthMiddlewareDeps): Router {
  const authRouter = Router();
  const requireAuth = createRequireAuth(deps);

  authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  return authRouter;
}
