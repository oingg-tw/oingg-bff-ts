import { AppError } from "@/domain/appError.js";
import {
  assertAnalysisServiceOk,
  buildAnalysisServiceUrl,
  fetchAnalysisService,
  requireNumber,
} from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { BookValueBreakdownEntry, BookValueBreakdownResult } from "@/application/proxy/stock/bookValueBreakdown.types.js";

/** 上游保證每一欄都是數字，所以全部走 requireNumber——缺了就 502 指名欄位，不靜默給 0。 */
const NUMERIC_FIELDS = [
  "fiscalYear",
  "openingBvps",
  "netIncome",
  "otherComprehensiveIncome",
  "cashDividends",
  "capitalIssued",
  "shareCountEffect",
  "other",
  "closingBvps",
] as const;

function normalizeEntry(raw: unknown): BookValueBreakdownEntry {
  const r = raw as Record<string, unknown>;
  const out = {} as Record<(typeof NUMERIC_FIELDS)[number], number>;
  for (const field of NUMERIC_FIELDS) {
    out[field] = requireNumber(r[field], field, "Book value breakdown");
  }
  return out as unknown as BookValueBreakdownEntry;
}

function isBookValueBreakdownResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * 每股淨值變動拆解，轉發 analysis-ts 的 GET /companies/book-value-breakdown?symbol=（他們 2026-09-27
 * 新增，commit 81782a3a），給前端畫瀑布圖用。
 *
 * 注意上游的路徑是 `?symbol=` 的查詢參數形式，不是 `/companies/:symbol/...`——跟 metric-history 那一族
 * 一樣，而 bff-ts 對外統一成 `/stocks/:symbol/book-value-breakdown`（這個切片的既有慣例）。
 *
 * 沒有 limit 之類的參數：一年一列、上游給全部（2330 是 7 列、5904 是 5 列）。查無資料回空陣列不是 404。
 */
export async function fetchBookValueBreakdown(symbol: string): Promise<BookValueBreakdownResult> {
  const url = buildAnalysisServiceUrl("/companies/book-value-breakdown", { symbol });
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Book value breakdown endpoint");

  const body: unknown = await response.json();
  if (!isBookValueBreakdownResponse(body)) {
    logger.error({ url: url.toString() }, "Book value breakdown endpoint response is missing an entries array");
    throw new AppError("Book value breakdown endpoint response is missing an entries array", 502);
  }

  return { symbol, entries: body.entries.map(normalizeEntry) };
}
