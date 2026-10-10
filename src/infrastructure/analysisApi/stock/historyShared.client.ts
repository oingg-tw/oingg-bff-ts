import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { FlatHistoryEntry, FlatHistoryPage, HistoryCoverage, HistoryPageMeta } from "@/application/proxy/stock/historyShared.types.js";

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
    // 年度（FY）列上游給 4（2026-10-10 實測，詞彙表的規定）。仍用 toNumberOrNull：缺值時要是 null，Number(null) 會變成「第 0 季」。
    fiscalQuarter: toNumberOrNull(r.fiscalQuarter),
    value: toNumberOrNull(r.value),
    nullReason: toStringOrNull(r.nullReason),
    knowledgeDate: String(r.knowledgeDate),
    knowledgeDateIsFallback: r.knowledgeDateIsFallback === true,
    formulaVersion: toFormulaVersion(r.formulaVersion),
    dataType: toDataType(r.dataType),
    // 布林要原樣：缺席（非每股類指標）是 null，不能讀成 false——見 FlatHistoryEntry.restated。
    restated: typeof r.restated === "boolean" ? r.restated : null,
    shareBasisDate: toStringOrNull(r.shareBasisDate),
  };
}

/** `{ from, to }` 或 null；兩端各自可為 null（不用 String()，那會把缺值變成 "null"）。 */
export function toCoverage(value: unknown): HistoryCoverage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const c = value as Record<string, unknown>;
  return { from: toStringOrNull(c.from), to: toStringOrNull(c.to) };
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

  await assertAnalysisServiceOk(response, url, `${label} endpoint`);

  const body: unknown = await response.json();
  if (!isFlatHistoryResponse(body)) {
    logger.error({ url: url.toString() }, `${label} endpoint response is missing an entries array`);
    throw new AppError(`${label} endpoint response is missing an entries array`, 502);
  }

  return {
    ...extractHistoryPageMeta(body),
    coverage: toCoverage((body as { coverage?: unknown }).coverage),
    entries: body.entries.map(normalizeFlatHistoryEntry),
  };
}
