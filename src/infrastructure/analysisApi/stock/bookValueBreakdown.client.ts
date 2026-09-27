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

/**
 * `dataType` 在這支端點是必填（只有年度資料、沒有日頻指標），所以缺了或不是 "1"/"2" 就丟 502——
 * 跟九個數字欄位同一個判斷。不預設成 "2"：那會把 31 家轉換公司的個別報表期悄悄標成合併，
 * 而下游的整個用途就是要區分這兩者。
 */
function requireDataType(value: unknown): "1" | "2" {
  if (value !== "1" && value !== "2") {
    logger.error({ received: typeof value === "string" ? value : typeof value }, "Book value breakdown entry has no usable dataType — upstream guarantees it, so this is probably a version skew");
    throw new AppError("Book value breakdown response is missing the dataType field", 502);
  }
  return value;
}

function normalizeEntry(raw: unknown): BookValueBreakdownEntry {
  const r = raw as Record<string, unknown>;
  const out = {} as Record<(typeof NUMERIC_FIELDS)[number], number>;
  for (const field of NUMERIC_FIELDS) {
    out[field] = requireNumber(r[field], field, "Book value breakdown");
  }
  return { ...(out as unknown as Omit<BookValueBreakdownEntry, "dataType">), dataType: requireDataType(r.dataType) };
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
