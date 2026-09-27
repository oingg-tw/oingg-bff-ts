import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { FlatHistoryEntry, FlatHistoryPage, HistoryPageMeta } from "@/application/proxy/stock/historyShared.types.js";

/**
 * The fetch+normalize half of what used to be application/proxy/stock/metricHistoryShared.ts. It lives
 * here because it *is* an analysis-ts client — it builds the URL, relays their 400, and 502s on a
 * malformed body, exactly like the per-endpoint clients beside it. The shapes it returns stayed in
 * application (historyShared.types.ts): those are this slice's outward contract, this file is how it
 * gets filled in.
 */

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

function normalizeFlatHistoryEntry(raw: unknown): FlatHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    fiscalYear: Number(r.fiscalYear),
    fiscalQuarter: Number(r.fiscalQuarter),
    value: toNumberOrNull(r.value),
    nullReason: toStringOrNull(r.nullReason),
    knowledgeDate: String(r.knowledgeDate),
    knowledgeDateIsFallback: r.knowledgeDateIsFallback === true,
    formulaVersion: toFormulaVersion(r.formulaVersion),
    dataType: toDataType(r.dataType),
  };
}

/**
 * 缺席時回 null 並記一筆 warning——理由見 FlatHistoryEntry.formulaVersion 的說明（缺了只少一個過期
 * 提示，不該讓整支端點失敗）。記 log 是為了讓版本錯開不會完全無聲。
 */
function toFormulaVersion(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  logger.warn({ received: typeof value }, "History entry has no formulaVersion — upstream guarantees it, so this is probably a version skew");
  return null;
}

function isFlatHistoryResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * `total`/`hasMore` are read the same way across every history endpoint in this domain (including
 * dupont-history and monthly-revenue-history, which don't use fetchFlatMetricHistory below since their
 * entry shape differs) — pulled out so all 5 clients extract them identically instead of duplicating
 * the same two-line cast.
 */
export function extractHistoryPageMeta(body: Record<string, unknown>): HistoryPageMeta {
  return {
    total: typeof body.total === "number" ? body.total : 0,
    hasMore: body.hasMore === true,
  };
}

/**
 * Shared fetch+normalize logic for analysis-ts's family of "one quarterly figure per entry" history
 * endpoints (metric-history, roe-history, roa-history) — all share the identical entry shape, differing
 * only in URL path and which basis values each accepts (confirmed live, 2026-09-07: metric-history's
 * basis validity varies per metricCode, roe/roa allow Q/Q_ANN/TTM). Relays analysis-ts's own 400 message
 * as-is (e.g. an invalid basis for that specific endpoint) rather than masking it as a generic 502, same
 * pattern as etfScreener.client.ts's handleJsonResponse. dupont-history is NOT part of this family — it
 * has a genuinely different entry shape (multiple decomposed figures per quarter, not one `value`), see
 * dupontHistory.client.ts.
 */
export async function fetchFlatMetricHistory(
  path: string,
  searchParams: Record<string, string>,
  label: string,
): Promise<FlatHistoryPage> {
  const url = buildAnalysisServiceUrl(path, searchParams);
  const response = await fetchAnalysisService(url);

  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== "string") {
      logger.error({ url: url.toString() }, `Invalid ${label} request, no message in response body`);
    }
    throw new AppError(typeof message === "string" ? message : `Invalid ${label} request`, 400);
  }
  assertAnalysisServiceOk(response, url, `${label} endpoint`);

  const body: unknown = await response.json();
  if (!isFlatHistoryResponse(body)) {
    logger.error({ url: url.toString() }, `${label} endpoint response is missing an entries array`);
    throw new AppError(`${label} endpoint response is missing an entries array`, 502);
  }

  return {
    ...extractHistoryPageMeta(body),
    entries: body.entries.map(normalizeFlatHistoryEntry),
  };
}
