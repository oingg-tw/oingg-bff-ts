import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import { normalizeExDividendCalendarEntry } from "@/infrastructure/analysisApi/stock/exDividendCalendar.client.js";
import type { ExDividendCalendarEntry } from "@/application/proxy/stock/exDividendCalendar.types.js";

const MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST = 100;

function isNoticesResponse(body: unknown): body is { notices: Record<string, unknown> } {
  const notices = (body as { notices?: unknown } | null)?.notices;
  return typeof body === "object" && body !== null && typeof notices === "object" && notices !== null;
}

/**
 * Batched upcoming ex-dividend/ex-rights lookup from analysis-ts's GET /stocks/ex-dividend-notices — same
 * batching convention as stockQuote.client.ts's fetchStockPrices (comma-separated symbols=, 100-symbol
 * hard cap, 500 if exceeded rather than a silent truncation). A symbol with no upcoming notice is simply
 * absent from the returned map (confirmed with analysis-ts), not present with an empty array. Each
 * symbol's own array is already sorted nearest-exDate-first by analysis-ts.
 *
 * 2026-10-06 起每筆跟 ex-dividend-calendar 的 entry 同形（上游改用行事曆的合併資料），所以共用
 * normalizeExDividendCalendarEntry，不再各寫一份逐欄位正規化——上游再加欄位時只要改一個地方。
 * 同時語意變了：除了還沒除息的（announced），也包含已除息但還沒發放的（realized）。
 *
 * 部署順序：這個正規化要求 status，舊形狀的上游（只有 DEV 已換新；PRD 還沒）會讓這支回 502。
 * bff-ts 的 PRD 部署必須排在 analysis-ts PRD 換上新版之後。
 */
export async function fetchExDividendNotices(symbols: string[]): Promise<Map<string, ExDividendCalendarEntry[]>> {
  if (symbols.length === 0) {
    return new Map();
  }
  if (symbols.length > MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST) {
    throw new AppError(
      `Requested ${symbols.length} symbols at once, but the ex-dividend notices endpoint caps at ${MAX_SYMBOLS_PER_EX_DIVIDEND_REQUEST}`,
      500,
    );
  }

  const url = buildAnalysisServiceUrl("/stocks/ex-dividend-notices", { symbols: symbols.join(",") });
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, "Ex-dividend notices endpoint");

  const body: unknown = await response.json();
  if (!isNoticesResponse(body)) {
    logger.error({ url: url.toString() }, 'Ex-dividend notices endpoint response is missing a "notices" object');
    throw new AppError('Ex-dividend notices endpoint response is missing a "notices" object', 502);
  }

  return new Map(
    Object.entries(body.notices).map(([symbol, entries]) => [
      symbol,
      (entries as unknown[]).map(normalizeExDividendCalendarEntry),
    ]),
  );
}
