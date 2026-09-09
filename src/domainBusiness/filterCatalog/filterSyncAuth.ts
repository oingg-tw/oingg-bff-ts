import type { NextFunction, Request, Response } from "ultimate-express";
import { requireEnv } from "@/shared/env.js";
import { stripQuotes, timingSafeEqualString } from "@/shared/secretAuth.js";

const HEADER_NAME = "x-filters-sync-secret";

/**
 * Gates POST /filters/sync (manual re-pull of analysis-ts's filter catalog, added 2026-09-09 so a copy
 * tweak on their side doesn't require restarting the whole bff-ts process — see
 * feedback_analysis_ts_must_not_know_bff_exists.md for why this has to be a manually-triggered pull, not
 * analysis-ts pushing to bff-ts) behind a shared-secret header, same TASK_SECRET convention as
 * oingg-twse-ts (stripQuotes + timingSafeEqual). Unlike /api-docs's Basic Auth gate, this fails closed in
 * every environment including dev — this endpoint actually triggers a DB write (replaceFilterCatalog),
 * not just a reconnaissance-surface concern, so there's no dev-friction tradeoff to make here.
 */
export function requireFilterSyncSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = stripQuotes(requireEnv("FILTERS_SYNC_SECRET"));
  const provided = req.headers[HEADER_NAME];

  if (typeof provided === "string" && timingSafeEqualString(provided, expected)) {
    next();
    return;
  }

  res.status(401).json({ error: { message: "Unauthorized" } });
}
