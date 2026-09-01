import { AppError } from "@/shared/errorHandler.js";
import {
  fetchForeignHoldingRanking,
  fetchMarginShortRatioRanking,
  fetchMaterialAnnouncements,
} from "@/domains/market/marketRankings.client.js";
import type {
  ForeignHoldingRankingResult,
  MarginShortRatioRankingResult,
  MaterialAnnouncementsResult,
} from "@/domains/market/market.types.js";

export const DEFAULT_FOREIGN_HOLDING_LIMIT = 10;
export const MIN_FOREIGN_HOLDING_LIMIT = 1;
export const MAX_FOREIGN_HOLDING_LIMIT = 20;

export const DEFAULT_MARGIN_SHORT_LIMIT = 20;
export const MIN_MARGIN_SHORT_LIMIT = 1;
export const MAX_MARGIN_SHORT_LIMIT = 100;

export const DEFAULT_MATERIAL_ANNOUNCEMENTS_LIMIT = 20;
export const MIN_MATERIAL_ANNOUNCEMENTS_LIMIT = 1;
export const MAX_MATERIAL_ANNOUNCEMENTS_LIMIT = 50;

/**
 * Bounds match analysis-ts's own validation (verified live) — checked here too for a fast local 400.
 * `limit` replaced this endpoint's original `topPercent` param as of 2026-09-01 (see
 * marketRankings.client.ts's fetchForeignHoldingRanking).
 */
export async function getForeignHoldingRanking(limit: number): Promise<ForeignHoldingRankingResult> {
  if (!Number.isInteger(limit) || limit < MIN_FOREIGN_HOLDING_LIMIT || limit > MAX_FOREIGN_HOLDING_LIMIT) {
    throw new AppError(
      `"limit" must be an integer between ${MIN_FOREIGN_HOLDING_LIMIT} and ${MAX_FOREIGN_HOLDING_LIMIT}`,
      400,
    );
  }
  return fetchForeignHoldingRanking(limit);
}

/** Bounds match analysis-ts's own validation (verified live) — checked here too for a fast local 400. */
export async function getMarginShortRatioRanking(limit: number): Promise<MarginShortRatioRankingResult> {
  if (!Number.isInteger(limit) || limit < MIN_MARGIN_SHORT_LIMIT || limit > MAX_MARGIN_SHORT_LIMIT) {
    throw new AppError(
      `"limit" must be an integer between ${MIN_MARGIN_SHORT_LIMIT} and ${MAX_MARGIN_SHORT_LIMIT}`,
      400,
    );
  }
  return fetchMarginShortRatioRanking(limit);
}

/** Bounds match analysis-ts's own validation (verified live) — checked here too for a fast local 400. */
export async function getMaterialAnnouncements(limit: number): Promise<MaterialAnnouncementsResult> {
  if (
    !Number.isInteger(limit) ||
    limit < MIN_MATERIAL_ANNOUNCEMENTS_LIMIT ||
    limit > MAX_MATERIAL_ANNOUNCEMENTS_LIMIT
  ) {
    throw new AppError(
      `"limit" must be an integer between ${MIN_MATERIAL_ANNOUNCEMENTS_LIMIT} and ${MAX_MATERIAL_ANNOUNCEMENTS_LIMIT}`,
      400,
    );
  }
  return fetchMaterialAnnouncements(limit);
}
