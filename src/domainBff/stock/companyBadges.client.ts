import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { CompanyBadgeCategory, CompanyBadgeEntry, CompanyBadgesResult } from "@/domainBff/stock/companyBadges.types.js";

function normalizeBadgeEntry(raw: unknown): CompanyBadgeEntry {
  const r = raw as Record<string, unknown>;
  return {
    metricCode: String(r.metricCode),
    name: String(r.name),
    nameEn: String(r.nameEn),
    timeframe: String(r.timeframe),
    value: typeof r.value === "number" ? r.value : null,
    nullReason: typeof r.nullReason === "string" ? r.nullReason : null,
    knowledgeDate: typeof r.knowledgeDate === "string" ? r.knowledgeDate : null,
    knowledgeDateIsFallback: typeof r.knowledgeDateIsFallback === "boolean" ? r.knowledgeDateIsFallback : null,
    passed: typeof r.passed === "boolean" ? r.passed : null,
    warning: typeof r.warning === "boolean" ? r.warning : null,
    percentile: typeof r.percentile === "number" ? r.percentile : null,
    rank: typeof r.rank === "number" ? r.rank : null,
    totalCount: typeof r.totalCount === "number" ? r.totalCount : null,
  };
}

function normalizeCategory(raw: unknown): CompanyBadgeCategory {
  const r = raw as Record<string, unknown>;
  return {
    categoryKey: String(r.categoryKey),
    categoryDisplayName: String(r.categoryDisplayName),
    badges: Array.isArray(r.badges) ? r.badges.map(normalizeBadgeEntry) : [],
  };
}

/**
 * Fetches a symbol's evaluated "guru badges" — the computed value and pass/fail for each badge, per
 * company — from analysis-ts's GET /companies/badges?symbol=. This is deliberately different from
 * GET /metrics' metric.badge (see companyBadges.types.ts): that describes the badge itself (market-wide,
 * not company-specific); this is the actual per-company result. `passed` is the single source of truth —
 * bff-ts must never recompute it by comparing `value` against MetricDefinition.badge.threshold itself
 * (the exact bug this endpoint was built to eliminate, per analysis-ts).
 *
 * An unknown or not-yet-backfilled symbol comes back 200 with every badge's value/nullReason/passed null,
 * not a 404 (confirmed live) — same convention as this domain's other per-symbol endpoints (beta, etc.).
 */
export async function fetchCompanyBadges(symbol: string): Promise<CompanyBadgesResult> {
  const url = buildAnalysisServiceUrl("/companies/badges", { symbol });
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Company badges endpoint");

  const body: unknown = await response.json();
  const b = body as { symbol?: unknown; categories?: unknown };
  if (typeof b.symbol !== "string" || !Array.isArray(b.categories)) {
    logger.error({ url: url.toString() }, "Company badges endpoint response is missing symbol/categories");
    throw new AppError("Company badges endpoint response is missing symbol/categories", 502);
  }

  return { symbol: b.symbol, categories: b.categories.map(normalizeCategory) };
}
