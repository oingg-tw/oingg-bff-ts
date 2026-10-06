import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  ExDividendCalendarEntry,
  ExDividendCalendarResult,
  ExDividendCalendarSecurityType,
  ExDividendCalendarStatus,
  ExDividendCompositionBreakdown,
} from "@/application/proxy/stock/exDividendCalendar.types.js";
import type { ExDividendType } from "@/application/proxy/stock/exDividendNotices.types.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function isExDividendType(value: unknown): value is ExDividendType {
  return value === "息" || value === "權" || value === "權息";
}

function isCalendarStatus(value: unknown): value is ExDividendCalendarStatus {
  return value === "announced" || value === "realized";
}

/**
 * Unknown values become null rather than throwing, unlike exType/status above. Those two gate fields the
 * whole row's meaning depends on; this one is a label, and a new upstream security type (回饋型? 槓桿型?)
 * shouldn't take down the whole month's calendar. The logged warning is how we find out.
 */
function toSecurityTypeOrNull(value: unknown, symbol: string): ExDividendCalendarSecurityType | null {
  if (value === "ETF" || value === "COMMON") {
    return value;
  }
  if (value !== null && value !== undefined) {
    logger.warn({ symbol, securityType: value }, "Ex-dividend calendar entry has an unrecognized securityType");
  }
  return null;
}

/**
 * 逐欄位取值，**null 與 0 都原樣保留**——`toNumberOrNull` 對 0 回 0（不是 null），而 0 在這裡是
 * 「揭露了而且是零」，跟「未揭露」意思不同。不要換成 `Number()` 或任何 falsy 判斷。
 */
function toCompositionOrNull(value: unknown): ExDividendCompositionBreakdown | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const c = value as Record<string, unknown>;
  return {
    dividendIncomePct: toNumberOrNull(c.dividendIncomePct),
    interestIncomePct: toNumberOrNull(c.interestIncomePct),
    incomeEqualizationPct: toNumberOrNull(c.incomeEqualizationPct),
    realizedCapitalGainPct: toNumberOrNull(c.realizedCapitalGainPct),
    otherIncomePct: toNumberOrNull(c.otherIncomePct),
  };
}

/** 2026-10-06 起 ex-dividend-notices 的每筆也是這個形狀（上游改用行事曆的合併資料），兩支共用這個正規化。 */
export function normalizeExDividendCalendarEntry(raw: unknown): ExDividendCalendarEntry {
  const r = raw as Record<string, unknown>;
  const symbol = String(r.symbol);
  if (!isExDividendType(r.exType)) {
    throw new AppError(`Ex-dividend calendar entry for "${symbol}" has an unrecognized exType`, 502);
  }
  if (!isCalendarStatus(r.status)) {
    throw new AppError(`Ex-dividend calendar entry for "${symbol}" has an unrecognized status`, 502);
  }
  return {
    symbol,
    companyName: typeof r.companyName === "string" ? r.companyName : null,
    status: r.status,
    paymentDate: typeof r.paymentDate === "string" ? r.paymentDate : null,
    fiscalYear: toNumberOrNull(r.fiscalYear),
    exDate: String(r.exDate),
    exType: r.exType,
    stockDividendRatio: toNumberOrNull(r.stockDividendRatio),
    subscriptionRatio: toNumberOrNull(r.subscriptionRatio),
    subscriptionPricePerShare: toNumberOrNull(r.subscriptionPricePerShare),
    cashDividend: toNumberOrNull(r.cashDividend),
    sharesOffered: toNumberOrNull(r.sharesOffered),
    sharesEmpOwner: toNumberOrNull(r.sharesEmpOwner),
    sharesholderOwner: toNumberOrNull(r.sharesholderOwner),
    stockHoldingRatio: toNumberOrNull(r.stockHoldingRatio),
    securityType: toSecurityTypeOrNull(r.securityType, symbol),
    recordDate: typeof r.recordDate === "string" ? r.recordDate : null,
    distributionPerUnit: toNumberOrNull(r.distributionPerUnit),
    composition: toCompositionOrNull(r.composition),
  };
}

function isCalendarResponse(body: unknown): body is { entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Market-wide ex-dividend/ex-rights calendar for one month from analysis-ts's own
 * GET /stocks/ex-dividend-calendar?month=YYYY-MM (added 2026-09-10) — same field shape as
 * GET /stocks/ex-dividend-notices (fetchExDividendNotices) but a flat array covering every symbol for the
 * given month, not grouped/filtered to one symbol's future events. Confirmed live: no future-only filter
 * (a month can be entirely in the past or future and still return its real events) and an out-of-range/no-data
 * month returns `entries: []`, not an error. The note that used to be here — companyName is null for ETFs —
 * was true on 2026-09-10 and is not any more (396/396 ETF rows named across 2026-06~09, re-measured
 * 2026-09-30); the field stays nullable but don't build on it being absent.
 *
 * securityType/recordDate/distributionPerUnit/composition were added upstream 2026-09-23 and went unwired
 * here for a week — the cost of a per-field normalizer, and the reason a field-set diff against upstream is
 * worth running rather than trusting that a new field arrives on its own.
 */
export async function fetchExDividendCalendar(month: string): Promise<ExDividendCalendarResult> {
  const url = buildAnalysisServiceUrl("/stocks/ex-dividend-calendar", { month });
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, "Ex-dividend calendar endpoint");

  const body: unknown = await response.json();
  if (!isCalendarResponse(body)) {
    logger.error({ url: url.toString() }, "Ex-dividend calendar endpoint response is missing an entries array");
    throw new AppError("Ex-dividend calendar endpoint response is missing an entries array", 502);
  }

  return { entries: body.entries.map(normalizeExDividendCalendarEntry) };
}
