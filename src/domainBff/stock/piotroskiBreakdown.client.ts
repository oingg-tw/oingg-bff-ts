import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { PiotroskiBreakdownGroups, PiotroskiBreakdownResult } from "@/domainBff/stock/piotroskiBreakdown.types.js";

function toBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeGroups(raw: unknown): PiotroskiBreakdownGroups | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const groups = raw as Record<string, unknown>;
  const profitability = (groups.profitability ?? {}) as Record<string, unknown>;
  const leverageLiquidity = (groups.leverageLiquidity ?? {}) as Record<string, unknown>;
  const operatingEfficiency = (groups.operatingEfficiency ?? {}) as Record<string, unknown>;

  return {
    profitability: {
      positiveRoa: toBooleanOrNull(profitability.positiveRoa),
      positiveCfo: toBooleanOrNull(profitability.positiveCfo),
      roaImproved: toBooleanOrNull(profitability.roaImproved),
      accrualQuality: toBooleanOrNull(profitability.accrualQuality),
    },
    leverageLiquidity: {
      leverageDecreased: toBooleanOrNull(leverageLiquidity.leverageDecreased),
      liquidityImproved: toBooleanOrNull(leverageLiquidity.liquidityImproved),
      noDilution: toBooleanOrNull(leverageLiquidity.noDilution),
    },
    operatingEfficiency: {
      grossMarginImproved: toBooleanOrNull(operatingEfficiency.grossMarginImproved),
      assetTurnoverImproved: toBooleanOrNull(operatingEfficiency.assetTurnoverImproved),
    },
  };
}

function isPiotroskiBreakdownResponse(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null;
}

/**
 * Fetches the Piotroski F-Score's 9 underlying boolean signals from analysis-ts's GET
 * /companies/piotroski-breakdown, grouped into 3 categories (profitability/leverageLiquidity/
 * operatingEfficiency) — backs web-nuxt splitting the existing single 9-point badge into 3 separate
 * per-category badges shown under their matching filter-catalog categories. Pure pass-through, zero
 * computation (see [[feedback_proxy_apis_no_transformation]]): bff-ts does not derive totalScore or any
 * sub-score itself — web-nuxt sums each group's own booleans client-side into its own
 * 4/3/2-denominator sub-score, applying the same null-propagation rule (one null signal nulls the whole
 * group/score) analysis-ts already applies to the persisted piotroskiFScore.Q. Omitting year/season gets
 * the latest quarter on file, same convention as fetchFinancialStatement. Always 200 — an unknown symbol
 * or a quarter with no data comes back with `found: false` and every other field null, never a 404
 * (confirmed live with analysis-ts directly, 2026-09-10).
 */
export async function fetchPiotroskiBreakdown(symbol: string, year?: string, season?: string): Promise<PiotroskiBreakdownResult> {
  const searchParams: Record<string, string> = { symbol };
  if (year !== undefined) {
    searchParams.year = year;
  }
  if (season !== undefined) {
    searchParams.season = season;
  }

  const url = buildAnalysisServiceUrl("/companies/piotroski-breakdown", searchParams);
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Piotroski breakdown endpoint");

  const body: unknown = await response.json();
  if (!isPiotroskiBreakdownResponse(body)) {
    logger.error({ url: url.toString() }, "Piotroski breakdown endpoint response is not an object");
    throw new AppError("Piotroski breakdown endpoint response is not an object", 502);
  }

  return {
    symbol: typeof body.symbol === "string" ? body.symbol : symbol,
    found: body.found === true,
    fiscalYear: toNumberOrNull(body.fiscalYear),
    fiscalQuarter: toNumberOrNull(body.fiscalQuarter),
    knowledgeDate: toStringOrNull(body.knowledgeDate),
    knowledgeDateIsFallback: toBooleanOrNull(body.knowledgeDateIsFallback),
    totalScore: toNumberOrNull(body.totalScore),
    groups: normalizeGroups(body.groups),
  };
}
