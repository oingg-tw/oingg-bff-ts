import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { DupontHistoryBasis, DupontHistoryEntry, DupontHistoryResult } from "@/application/proxy/stock/dupontHistory.types.js";
import { extractHistoryPageMeta } from "@/infrastructure/analysisApi/stock/historyShared.client.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * `dataType` 只接受 `"1"` 或 `"2"`，其他一律回 null。
 *
 * 不用 `String(r.dataType)`：那會把缺席的欄位變成字串 `"undefined"`，而 `"undefined"` 是個合法字串、
 * 型別上過關、下游拿它去比 `=== "1"` 得到 false——症狀是「全部看起來都是合併報表」。這跟今天
 * `Number(null)` 變成 0 是同一類錯（見 dailyPriceHistory.client.ts）。
 */
function toDataType(value: unknown): "1" | "2" | null {
  return value === "1" || value === "2" ? value : null;
}

function normalizeEntry(raw: unknown): DupontHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    fiscalYear: Number(r.fiscalYear),
    fiscalQuarter: toNumberOrNull(r.fiscalQuarter),
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
    dataType: toDataType(r.dataType),
  };
}

function isDupontHistoryResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches DuPont-decomposed ROE quarterly history from analysis-ts's GET /companies/dupont-history — a
 * genuinely different entry shape from metric-history/roe-history/roa-history (3 decomposed factors per
 * quarter, not one `value`), so this doesn't share historyShared.client.ts's helper. Only allows basis
 * Q/TTM (no Q_ANN, unlike roe-history/roa-history — confirmed live, 2026-09-07). Same 400-relay and
 * empty-array-not-404 conventions as the other history endpoints in this domain.
 *
 * analysis-ts renamed this endpoint's query param from `basis` to `periodType` on 2026-09-08 — same
 * `metric_values.basis` naming split as metric-history/roe-history/roa-history. Allowed values unchanged;
 * kept this client's own parameter/type names as `basis`, only the wire-level param sent upstream changed.
 */
export async function fetchDupontHistory(
  symbol: string,
  basis: DupontHistoryBasis,
  limit?: number,
): Promise<DupontHistoryResult & { basis: string }> {
  const searchParams: Record<string, string> = { symbol, timeframe: basis }; // 上游 05967082 起叫 timeframe（periodType 2026-10-24 移除）
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }

  const url = buildAnalysisServiceUrl("/companies/dupont-history", searchParams);
  const response = await fetchAnalysisService(url);

  await assertAnalysisServiceOk(response, url, "Dupont history endpoint");

  const body: unknown = await response.json();
  if (!isDupontHistoryResponse(body)) {
    logger.error({ url: url.toString() }, "Dupont history endpoint response is missing an entries array");
    throw new AppError("Dupont history endpoint response is missing an entries array", 502);
  }

  // basis 是並存期舊名（2026-10-10 起改叫 timeframe），web-nuxt 改完就刪。
  return { symbol, timeframe: basis, ...extractHistoryPageMeta(body), entries: body.entries.map(normalizeEntry), basis };
}
