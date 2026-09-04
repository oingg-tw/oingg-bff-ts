import { Router } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/shared/errorHandler.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { requireAuth } from "@/domains/auth/auth.middleware.js";
import type { AuthenticatedRequest } from "@/domains/auth/auth.types.js";
import { addHolding, editHolding, getHoldingOrThrow, getHoldings, removeHolding } from "@/domains/holdings/holdings.service.js";
import type { HoldingUpdate } from "@/domains/holdings/holdings.repository.js";

export const holdingsRouter = Router();

holdingsRouter.use(requireAuth);

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

holdingsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const holdings = await getHoldings(firebaseUid);
  res.json({ holdings });
});

holdingsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const body = parseBody(createHoldingSchema, req.body);

  const holding = await addHolding(firebaseUid, body.symbol, body.quantity, body.averageCost, body.note ?? null);
  res.status(201).json({ holding });
});

holdingsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  const holding = await getHoldingOrThrow(firebaseUid, id);
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

  const holding = await editHolding(firebaseUid, id, update);
  res.json({ holding });
});

holdingsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const firebaseUid = requireUser(req);
  const id = parseId(req.params.id ?? "");
  await removeHolding(firebaseUid, id);
  res.status(204).end();
});
