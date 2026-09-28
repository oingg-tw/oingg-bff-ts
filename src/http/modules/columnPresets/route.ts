import { Router, type NextFunction, type Response } from "ultimate-express";
import { z } from "zod";
import { AppError } from "@/domain/appError.js";
import { parseUuidParam } from "@/shared/uuid.js";
import { parseBody } from "@/shared/validation.js";
import { createRequireAuth, type AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import {
  addColumnPreset,
  editColumnPreset,
  getColumnPresetOrThrow,
  getColumnPresets,
  removeColumnPreset,
  reorderColumnPresetsForUser,
  type ColumnPresetsDeps,
} from "@/application/screener/columnPresets.service.js";
import { enforceQuota, type QuotaMiddlewareDeps } from "@/http/middleware/quota.middleware.js";

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError("Authenticated request is missing decoded user", 401);
  }
  return req.user.uid;
}

function parseId(raw: string): string {
  return parseUuidParam(raw, "column preset");
}

const columnFieldSchema = z.object({ field: z.string().trim().min(1) });

/**
 * 名稱已經被用掉就直接回 409，**在額度 guard 之前**——理由與 watchlist 的 rejectExistingSymbol 相同，
 * 見 quota.middleware.ts。body 解析兩次是刻意的，同一個理由。
 */
function rejectExistingName(deps: ColumnPresetsDeps) {
  return async function existingNameGuard(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      const firebaseUid = requireUser(req);
      const body = parseBody(createColumnPresetSchema, req.body);
      if (await deps.columnPresets.findByName(firebaseUid, body.name)) {
        next(new AppError(`You already have a column preset named "${body.name}"`, 409));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const createColumnPresetSchema = z.object({
  name: z.string().trim().min(1, '"name" is required'),
  columns: z.array(columnFieldSchema),
  isDefault: z.boolean().optional(),
});

export const updateColumnPresetSchema = z.object({
  name: z.string().trim().min(1).optional(),
  columns: z.array(columnFieldSchema).optional(),
  isDefault: z.boolean().optional(),
});

export const reorderColumnPresetsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, '"ids" must be a non-empty array of UUIDs'),
});

/**
 * 路由改成工廠函式：依賴由 bootstrap 注入，而不是在模組載入時自己去 import 實作。
 * 額度檢查的 countColumnPresets 同樣不再從 repository import，改走 deps.columnPresets.count——
 * 見 screenerPresets/route.ts 的同一段說明。
 */
export function createColumnPresetsRouter(
  deps: ColumnPresetsDeps & AuthMiddlewareDeps & QuotaMiddlewareDeps,
): Router {
  const columnPresetsRouter = Router();
  columnPresetsRouter.use(createRequireAuth(deps));

  columnPresetsRouter.get("/", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const columnPresets = await getColumnPresets(firebaseUid, deps);
    res.json({ columnPresets });
  });

  // Creation only — see the same note on POST /screener/presets.
  // rejectExistingName 必須排在 enforceQuota 之前，理由見 quota.middleware.ts 的掛載順序說明。
  columnPresetsRouter.post(
    "/",
    rejectExistingName(deps),
    enforceQuota("columnPresets", (uid) => deps.columnPresets.count(uid), deps),
    async (req: AuthenticatedRequest, res) => {
      const firebaseUid = requireUser(req);
      const body = parseBody(createColumnPresetSchema, req.body);

      const columnPreset = await addColumnPreset(
        firebaseUid,
        body.name,
        body.columns.map((c) => c.field),
        body.isDefault ?? false,
        deps,
      );
      res.status(201).json({ columnPreset });
    },
  );

  // Mounted before the "/:id" routes below, or "reorder" would be captured as an :id — though since this
  // is POST and the /:id routes are all GET/PATCH/DELETE, there's no actual method collision either way.
  columnPresetsRouter.post("/reorder", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const body = parseBody(reorderColumnPresetsSchema, req.body);
    const columnPresets = await reorderColumnPresetsForUser(firebaseUid, body.ids, deps);
    res.json({ columnPresets });
  });

  columnPresetsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    const columnPreset = await getColumnPresetOrThrow(firebaseUid, id, deps);
    res.json({ columnPreset });
  });

  columnPresetsRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    const body = parseBody(updateColumnPresetSchema, req.body ?? {});

    const columnPreset = await editColumnPreset(
      firebaseUid,
      id,
      {
        name: body.name,
        columns: body.columns?.map((c) => c.field),
        isDefault: body.isDefault,
      },
      deps,
    );
    res.json({ columnPreset });
  });

  columnPresetsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
    const firebaseUid = requireUser(req);
    const id = parseId(req.params.id ?? "");
    await removeColumnPreset(firebaseUid, id, deps);
    res.status(204).end();
  });

  return columnPresetsRouter;
}
