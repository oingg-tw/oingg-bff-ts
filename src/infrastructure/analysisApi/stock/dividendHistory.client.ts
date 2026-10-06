import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService, requireNumber } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { DividendEvent, DividendHistoryEntry, DividendHistoryResult } from "@/application/proxy/stock/dividendHistory.types.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * 上游保證是數字的欄位，缺席時**大聲失敗**而不是靜默變成 null 或 0。
 *
 * 2026-09-25 的教訓：上游把公積欄位改名，bff-ts 還在讀舊名，於是 `Number(undefined)` 產生 NaN、
 * 序列化成 null，而型別宣告說它不可能是 null。當時我一度把型別改成可為 null——那是**用型別吸收契約
 * 違反**，方向錯了：analysis-ts 的回應 schema 要求這些欄位必填、空白的公告格子在他們那層就併成 0，
 * 所以「欄位不見了」只可能是兩邊版本錯開，不是一種資料狀態。
 *
 * 版本錯開要在邊界上看得見。當天我是靠手動打上游比對才發現的；換成這裡丟 502，一個請求就會講出是
 * 哪個欄位不見了。代價是改版空窗期這支端點會整支失敗，那是正確的——資料確實無法以宣告的形狀提供，
 * 而下游對 502 本來就有降級行為。
 */
function normalizeEvent(raw: unknown): DividendEvent {
  const r = raw as Record<string, unknown>;
  return {
    fiscalQuarter: toNumberOrNull(r.fiscalQuarter),
    cashDividend: Number(r.cashDividend),
    cashDividendFromEarnings: requireNumber(r.cashDividendFromEarnings, "cashDividendFromEarnings", "Dividend history"),
    cashDividendFromLegalReserveAndCapitalSurplus: requireNumber(r.cashDividendFromLegalReserveAndCapitalSurplus, "cashDividendFromLegalReserveAndCapitalSurplus", "Dividend history"),
    stockDividend: Number(r.stockDividend),
    exDividendDate: toStringOrNull(r.exDividendDate),
    exRightsDate: toStringOrNull(r.exRightsDate),
    paymentDate: toStringOrNull(r.paymentDate),
    announcementDate: toStringOrNull(r.announcementDate),
    closeAtExDate: toNumberOrNull(r.closeAtExDate),
    yieldAtExDate: toNumberOrNull(r.yieldAtExDate),
  };
}

function normalizeEntry(raw: unknown): DividendHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    // **不要用 Number()**：2026-10-05 起上游對「公告沒填所屬年度」的那一列送 null，而 Number(null) 是 0——
    // 這裡原本就是這樣寫的，2496 的最後一列因此被轉成「fiscalYear 0、rocFiscalYear 0」送給前端，
    // 沒有錯誤、只是值悄悄錯了（實測 2026-10-05）。
    fiscalYear: toNumberOrNull(r.fiscalYear),
    rocFiscalYear: toNumberOrNull(r.rocFiscalYear),
    cashDividend: Number(r.cashDividend),
    cashDividendFromEarnings: requireNumber(r.cashDividendFromEarnings, "cashDividendFromEarnings", "Dividend history"),
    cashDividendFromLegalReserveAndCapitalSurplus: requireNumber(r.cashDividendFromLegalReserveAndCapitalSurplus, "cashDividendFromLegalReserveAndCapitalSurplus", "Dividend history"),
    stockDividend: Number(r.stockDividend),
    totalDividend: Number(r.totalDividend),
    distributionCount: Number(r.distributionCount),
    exDividendDate: toStringOrNull(r.exDividendDate),
    exRightsDate: toStringOrNull(r.exRightsDate),
    paymentDate: toStringOrNull(r.paymentDate),
    eps: toNumberOrNull(r.eps),
    payoutRatio: toNumberOrNull(r.payoutRatio),
    yieldAtExDate: toNumberOrNull(r.yieldAtExDate),
    knowledgeDate: toStringOrNull(r.knowledgeDate),
    events: Array.isArray(r.events) ? r.events.map(normalizeEvent) : [],
  };
}

function isDividendHistoryResponse(body: unknown): body is { symbol?: unknown; entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches a company's fiscal-year dividend history from analysis-ts's GET /companies/dividend-history?symbol=,
 * added 2026-09-19 for web-nuxt's SEO content thickening (歷年股利表). Oldest to newest (opposite order
 * from capital-stock-history's newest-to-oldest — confirmed live). Always 200, never 404 — an unknown or
 * no-data symbol just gets back an empty `entries` array, same convention as capital-stock-history.
 */
export async function fetchDividendHistory(symbol: string): Promise<DividendHistoryResult> {
  const url = buildAnalysisServiceUrl("/companies/dividend-history", { symbol });
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, "Dividend history endpoint");

  const body: unknown = await response.json();
  if (!isDividendHistoryResponse(body)) {
    logger.error({ url: url.toString() }, "Dividend history endpoint response is missing an entries array");
    throw new AppError("Dividend history endpoint response is missing an entries array", 502);
  }

  return {
    symbol: typeof body.symbol === "string" ? body.symbol : symbol,
    entries: body.entries.map(normalizeEntry),
  };
}
