import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  BusinessCycleIndicatorEntry,
  BusinessCycleIndicatorResult,
  CbcPolicyRateEntry,
  CbcPolicyRateResult,
  CpiCategory,
  CpiEntry,
  CpiResult,
  GdpCategory,
  GdpEntry,
  GdpResult,
  GovBondYield10yHistoryEntry,
  GovBondYield10yHistoryResult,
  GovBondYield10yResult,
  MonetaryAggregateEntry,
  MonetaryAggregateResult,
  UsdTwdRateEntry,
  UsdTwdRateInterval,
  UsdTwdRateResult,
} from "@/domainBff/macro/macro.types.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Every macro series endpoint returns `{ entries: [...] }` (some with extra top-level fields) — this
 * fetches, checks the upstream status, and asserts the array is there, returning the raw body for the
 * caller to normalize. Only omits undefined params from the query so a caller that passes nothing keeps
 * the bare upstream request.
 */
async function getEntriesBody(
  path: string,
  params: Record<string, string | undefined>,
  label: string,
): Promise<{ body: Record<string, unknown>; entries: unknown[] }> {
  const searchParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams[key] = value;
    }
  }

  const url = buildAnalysisServiceUrl(path, Object.keys(searchParams).length > 0 ? searchParams : undefined);
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, label);

  const body: unknown = await response.json();
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) {
    logger.error({ url: url.toString() }, `${label} response is missing an entries array`);
    throw new AppError(`${label} response is missing an entries array`, 502);
  }

  return { body: body as Record<string, unknown>, entries };
}

function normalizeCbcPolicyRateEntry(raw: unknown): CbcPolicyRateEntry {
  const r = raw as Record<string, unknown>;
  return {
    effectiveDate: String(r.effectiveDate),
    discountRate: Number(r.discountRate),
    collateralAccommodationRate: Number(r.collateralAccommodationRate),
    unsecuredAccommodationRate: Number(r.unsecuredAccommodationRate),
    changeBp: toNumberOrNull(r.changeBp),
  };
}

/**
 * Fetches the CBC policy-rate event series from analysis-ts's GET /macro/cbc-policy-rate — added 2026-09-21
 * for web-nuxt's "TAIEX overlaid with rate-hike/cut events" chart (pair with GET /market/taiex-daily-price's
 * `interval=monthly`, since the rate history reaches 1989 and daily TAIEX only reaches ~2018 within its
 * row limit). `from` ("YYYY-MM-DD") keeps only events with effectiveDate >= that day; omitted returns the
 * whole history. Format is validated locally before this is called (see macro.service.ts) — analysis-ts
 * 400s on a malformed value too, this just avoids the round trip.
 */
export async function fetchCbcPolicyRate(from?: string): Promise<CbcPolicyRateResult> {
  const { entries } = await getEntriesBody("/macro/cbc-policy-rate", { from }, "CBC policy rate endpoint");
  return { entries: entries.map(normalizeCbcPolicyRateEntry) };
}

function normalizeBusinessCycleIndicatorEntry(raw: unknown): BusinessCycleIndicatorEntry {
  const r = raw as Record<string, unknown>;
  return {
    period: String(r.period),
    year: Number(r.year),
    month: Number(r.month),
    leadingIndexComposite: toNumberOrNull(r.leadingIndexComposite),
    leadingIndexDetrended: toNumberOrNull(r.leadingIndexDetrended),
    coincidentIndexComposite: toNumberOrNull(r.coincidentIndexComposite),
    coincidentIndexDetrended: toNumberOrNull(r.coincidentIndexDetrended),
    laggingIndexComposite: toNumberOrNull(r.laggingIndexComposite),
    laggingIndexDetrended: toNumberOrNull(r.laggingIndexDetrended),
    signalScore: toNumberOrNull(r.signalScore),
    signalLight: toStringOrNull(r.signalLight),
  };
}

/** 國發會 景氣指標 + 景氣對策信號, monthly from 1982-01 — GET /macro/business-cycle-indicator. */
export async function fetchBusinessCycleIndicator(from?: string): Promise<BusinessCycleIndicatorResult> {
  const { entries } = await getEntriesBody("/macro/business-cycle-indicator", { from }, "Business cycle indicator endpoint");
  return { entries: entries.map(normalizeBusinessCycleIndicatorEntry) };
}

function normalizeMonetaryAggregateEntry(raw: unknown): MonetaryAggregateEntry {
  const r = raw as Record<string, unknown>;
  return {
    period: String(r.period),
    year: Number(r.year),
    month: Number(r.month),
    m1aAmount: toNumberOrNull(r.m1aAmount),
    m1aYoyPercent: toNumberOrNull(r.m1aYoyPercent),
    m1bAmount: toNumberOrNull(r.m1bAmount),
    m1bYoyPercent: toNumberOrNull(r.m1bYoyPercent),
    m2Amount: toNumberOrNull(r.m2Amount),
    m2YoyPercent: toNumberOrNull(r.m2YoyPercent),
  };
}

/** 央行 M1A/M1B/M2 monthly — GET /macro/monetary-aggregate. */
export async function fetchMonetaryAggregate(from?: string): Promise<MonetaryAggregateResult> {
  const { entries } = await getEntriesBody("/macro/monetary-aggregate", { from }, "Monetary aggregate endpoint");
  return { entries: entries.map(normalizeMonetaryAggregateEntry) };
}

function normalizeGovBondYield10yHistoryEntry(raw: unknown): GovBondYield10yHistoryEntry {
  const r = raw as Record<string, unknown>;
  return {
    period: String(r.period),
    year: Number(r.year),
    month: Number(r.month),
    yieldPct: toNumberOrNull(r.yieldPct),
  };
}

/**
 * Latest 10-year 公債殖利率 snapshot — GET /macro/gov-bond-yield-10y (the pre-existing point-in-time
 * endpoint; unlike the series endpoints it has no `entries`, so it doesn't go through getEntriesBody).
 */
export async function fetchGovBondYield10y(): Promise<GovBondYield10yResult> {
  const url = buildAnalysisServiceUrl("/macro/gov-bond-yield-10y");
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Gov bond yield 10y endpoint");

  const body = (await response.json()) as Record<string, unknown> | null;
  if (typeof body !== "object" || body === null || !("yieldPct" in body)) {
    logger.error({ url: url.toString() }, "Gov bond yield 10y endpoint response is missing yieldPct");
    throw new AppError("Gov bond yield 10y endpoint response is missing yieldPct", 502);
  }

  const rawStatuses = body.fieldStatuses;
  const fieldStatuses: Record<string, string> = {};
  if (typeof rawStatuses === "object" && rawStatuses !== null) {
    for (const [key, value] of Object.entries(rawStatuses as Record<string, unknown>)) {
      fieldStatuses[key] = String(value);
    }
  }

  return {
    yieldPct: toNumberOrNull(body.yieldPct),
    asOfMonth: toStringOrNull(body.asOfMonth),
    fieldStatuses,
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}

/** 10-year 公債殖利率 monthly history — GET /macro/gov-bond-yield-10y-history. */
export async function fetchGovBondYield10yHistory(from?: string): Promise<GovBondYield10yHistoryResult> {
  const { entries } = await getEntriesBody("/macro/gov-bond-yield-10y-history", { from }, "Gov bond yield 10y history endpoint");
  return { entries: entries.map(normalizeGovBondYield10yHistoryEntry) };
}

function normalizeUsdTwdRateEntry(raw: unknown): UsdTwdRateEntry {
  const r = raw as Record<string, unknown>;
  return {
    tradeDate: String(r.tradeDate),
    bankBuyingRate: toNumberOrNull(r.bankBuyingRate),
    bankSellingRate: toNumberOrNull(r.bankSellingRate),
    interbankClosingRate: toNumberOrNull(r.interbankClosingRate),
  };
}

/**
 * USD/TWD daily series — GET /macro/usd-twd-rate. Same `limit` (1-2000, default 250) and `interval`
 * (daily/weekly/monthly, default daily) semantics as GET /market/taiex-daily-price; both are only sent when
 * given so the bare call keeps the upstream defaults.
 */
export async function fetchUsdTwdRate(limit?: number, interval?: UsdTwdRateInterval): Promise<UsdTwdRateResult> {
  const { entries } = await getEntriesBody(
    "/macro/usd-twd-rate",
    { limit: limit !== undefined ? String(limit) : undefined, interval },
    "USD/TWD rate endpoint",
  );
  return { entries: entries.map(normalizeUsdTwdRateEntry) };
}

function normalizeCpiEntry(raw: unknown): CpiEntry {
  const r = raw as Record<string, unknown>;
  return {
    period: String(r.period),
    year: Number(r.year),
    month: Number(r.month),
    indexValue: toNumberOrNull(r.indexValue),
    yoyChangePercent: toNumberOrNull(r.yoyChangePercent),
  };
}

/** 主計總處 CPI monthly, one basket category per call (default "total" upstream) — GET /macro/cpi. */
export async function fetchCpi(from?: string, category?: CpiCategory): Promise<CpiResult> {
  const { body, entries } = await getEntriesBody("/macro/cpi", { from, category }, "CPI endpoint");
  if (typeof body.category !== "string") {
    throw new AppError("CPI endpoint response is missing a category string", 502);
  }
  return { category: body.category as CpiCategory, entries: entries.map(normalizeCpiEntry) };
}

function normalizeGdpEntry(raw: unknown): GdpEntry {
  const r = raw as Record<string, unknown>;
  return {
    period: String(r.period),
    year: Number(r.year),
    quarter: Number(r.quarter),
    contributionPoints: toNumberOrNull(r.contributionPoints),
  };
}

/** 主計總處 GDP quarterly, one expenditure component per call (default "growth_rate" upstream) — GET /macro/gdp. */
export async function fetchGdp(from?: string, category?: GdpCategory): Promise<GdpResult> {
  const { body, entries } = await getEntriesBody("/macro/gdp", { from, category }, "GDP endpoint");
  if (typeof body.category !== "string") {
    throw new AppError("GDP endpoint response is missing a category string", 502);
  }
  return { category: body.category as GdpCategory, entries: entries.map(normalizeGdpEntry) };
}
