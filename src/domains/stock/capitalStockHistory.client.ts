import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import type {
  CapitalStockChangeSource,
  CapitalStockHistoryEntry,
  CapitalStockHistoryResult,
} from "@/domains/stock/capitalStockHistory.types.js";

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

function normalizeEntry(raw: unknown): CapitalStockHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    effectiveDate: String(r.effectiveDate),
    paidInShares: String(r.paidInShares),
    paidInCapital: String(r.paidInCapital),
    changeSource: normalizeChangeSource(r.changeSource),
    remarks: toStringOrNull(r.remarks),
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
  assertAnalysisServiceOk(response, url, "Capital stock history endpoint");

  const body: unknown = await response.json();
  if (!isCapitalStockHistoryResponse(body)) {
    console.error(`Capital stock history endpoint response at ${url.toString()} is missing an entries array`);
    throw new AppError("Capital stock history endpoint response is missing an entries array", 502);
  }

  return {
    symbol: typeof body.symbol === "string" ? body.symbol : symbol,
    entries: body.entries.map(normalizeEntry),
  };
}
