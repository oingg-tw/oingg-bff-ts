import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  CapitalStockChangeSource,
  CapitalStockHistoryEntry,
  CapitalStockHistoryResult,
} from "@/application/proxy/stock/capitalStockHistory.types.js";

function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function normalizeChangeSource(raw: unknown): CapitalStockChangeSource {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    cashIncrease: toStringOrNull(r.cashIncrease),
    capitalReserveTransfer: toStringOrNull(r.capitalReserveTransfer),
    retainedEarningsTransfer: toStringOrNull(r.retainedEarningsTransfer),
    mergerIncrease: toStringOrNull(r.mergerIncrease),
    capitalReduction: toStringOrNull(r.capitalReduction),
    other: toStringOrNull(r.other),
  };
}

/**
 * 已發行股數（2026-10-10 前上游叫 paidInShares，2026-10-24 移除舊名）：上游保證的欄位，大整數字串。缺了是上游壞了，
 * 回 502——不要 String(undefined)，那會在畫面上變成一個看起來像資料的 "undefined"。
 */
function requireSharesString(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  throw new AppError("Capital stock history entry is missing numberOfSharesIssued", 502);
}

function normalizeEntry(raw: unknown): CapitalStockHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    effectiveDate: String(r.effectiveDate),
    numberOfSharesIssued: requireSharesString(r.numberOfSharesIssued ?? r.paidInShares),
    paidInCapital: toStringOrNull(r.paidInCapital),
    changeSource: normalizeChangeSource(r.changeSource),
    remarks: toStringOrNull(r.remarks),
    sharesChangePct: typeof (r.sharesChangePct ?? r.sharesChangePercent) === "number" ? ((r.sharesChangePct ?? r.sharesChangePercent) as number) : null,
  };
}

function isCapitalStockHistoryResponse(body: unknown): body is { symbol?: unknown; entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches a company's historical paid-in-capital/shares changes from analysis-ts's
 * GET /companies/capital-stock-history?symbol=, newest to oldest. Always 200, never 404 — an unknown or
 * no-data symbol just gets back an empty `entries` array (confirmed with analysis-ts directly).
 */
export async function fetchCapitalStockHistory(symbol: string): Promise<CapitalStockHistoryResult> {
  const url = buildAnalysisServiceUrl("/companies/capital-stock-history", { symbol });
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, "Capital stock history endpoint");

  const body: unknown = await response.json();
  if (!isCapitalStockHistoryResponse(body)) {
    logger.error({ url: url.toString() }, "Capital stock history endpoint response is missing an entries array");
    throw new AppError("Capital stock history endpoint response is missing an entries array", 502);
  }

  return {
    symbol: typeof body.symbol === "string" ? body.symbol : symbol,
    entries: body.entries.map(normalizeEntry),
  };
}
