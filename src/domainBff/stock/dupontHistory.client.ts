import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { DupontHistoryBasis, DupontHistoryEntry, DupontHistoryResult } from "@/domainBff/stock/dupontHistory.types.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeEntry(raw: unknown): DupontHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    fiscalYear: Number(r.fiscalYear),
    fiscalQuarter: Number(r.fiscalQuarter),
    netProfitMarginPct: toNumberOrNull(r.netProfitMarginPct),
    assetTurnover: toNumberOrNull(r.assetTurnover),
    equityMultiplier: toNumberOrNull(r.equityMultiplier),
    decomposedRoePct: toNumberOrNull(r.decomposedRoePct),
    nullReason: toStringOrNull(r.nullReason),
    dupontTaxBurdenPct: toNumberOrNull(r.dupontTaxBurdenPct),
    dupontInterestBurdenPct: toNumberOrNull(r.dupontInterestBurdenPct),
    dupontEbitMarginPct: toNumberOrNull(r.dupontEbitMarginPct),
    dupontExtendedRoePct: toNumberOrNull(r.dupontExtendedRoePct),
    dupontExtendedRoeNullReason: toStringOrNull(r.dupontExtendedRoeNullReason),
    knowledgeDate: String(r.knowledgeDate),
    knowledgeDateIsFallback: r.knowledgeDateIsFallback === true,
  };
}

function isDupontHistoryResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches DuPont-decomposed ROE quarterly history from analysis-ts's GET /companies/dupont-history — a
 * genuinely different entry shape from metric-history/roe-history/roa-history (3 decomposed factors per
 * quarter, not one `value`), so this doesn't share metricHistoryShared.ts's helper. Only allows basis
 * Q/TTM (no Q_ANN, unlike roe-history/roa-history — confirmed live, 2026-09-07). Same 400-relay and
 * empty-array-not-404 conventions as the other history endpoints in this domain.
 */
export async function fetchDupontHistory(
  symbol: string,
  basis: DupontHistoryBasis,
  limit?: number,
): Promise<DupontHistoryResult> {
  const searchParams: Record<string, string> = { symbol, basis };
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }

  const url = buildAnalysisServiceUrl("/companies/dupont-history", searchParams);
  const response = await fetchAnalysisService(url);

  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== "string") {
      logger.error({ url: url.toString() }, "Invalid dupont history request, no message in response body");
    }
    throw new AppError(typeof message === "string" ? message : "Invalid dupont history request", 400);
  }
  assertAnalysisServiceOk(response, url, "Dupont history endpoint");

  const body: unknown = await response.json();
  if (!isDupontHistoryResponse(body)) {
    logger.error({ url: url.toString() }, "Dupont history endpoint response is missing an entries array");
    throw new AppError("Dupont history endpoint response is missing an entries array", 502);
  }

  return { symbol, basis, entries: body.entries.map(normalizeEntry) };
}
