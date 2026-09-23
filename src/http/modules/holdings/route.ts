import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import { assertSymbolExists, type StockProxyDeps } from "@/application/proxy/stock/stock.service.js";
import { addHolding, editHolding, getHoldingOrThrow, getHoldings, removeHolding } from "@/application/holdings/holdings.service.js";
import type { HoldingsDeps } from "@/application/holdings/holdings.service.js";
import type { HoldingUpdate } from "@/application/holdings/holdings.types.js";

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): string {
  return parseUuidParam(raw, "holding");
}

export const createHoldingSchema = z.object({
  symbol: z.string().trim().min(1, '"symbol" is required'),
  quantity: z.number(),
  averageCost: z.number(),
  note: z.string().nullish(),
});

export const updateHoldingSchema = z.object({
  quantity: z.number().optional(),
  averageCost: z.number().optional(),
  note: z.string().nullish(),
});

/**
 * 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。
 * 這是 http 層不再依賴 infrastructure 的關鍵——它只認得 application 匯出的型別。
 */
export function createHoldingsRouter(deps: HoldingsDeps & StockProxyDeps & AuthMiddlewareDeps): Router {
  const holdingsRouter = Router();
  holdingsRouter.use(createRequireAuth(deps));

  holdingsRouter.get("/", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const holdings = await getHoldings(firebaseUid, deps);
    res.json({ holdings });
  });

  holdingsRouter.post("/", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(createHoldingSchema, req.body);

    await assertSymbolExists(body.symbol, deps);
    const holding = await addHolding(firebaseUid, body.symbol, body.quantity, body.averageCost, body.note ?? null, deps);
    res.status(201).json({ holding });
  });

  holdingsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    const holding = await getHoldingOrThrow(firebaseUid, id, deps);
    res.json({ holding });
  });

  holdingsRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    const body = parseBody(updateHoldingSchema, req.body ?? {});

    const update: HoldingUpdate = {};
    if (body.quantity !== undefined) {
      update.quantity = body.quantity;
    }
    if (body.averageCost !== undefined) {
      update.averageCost = body.averageCost;
    }
    if (body.note !== undefined) {
      update.note = body.note;
    }

    const holding = await editHolding(firebaseUid, id, update, deps);
    res.json({ holding });
  });

  holdingsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    await removeHolding(firebaseUid, id, deps);
    res.status(204).end();
  });

  return holdingsRouter;
}
