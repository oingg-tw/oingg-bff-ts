import { AppError } from "@/shared/errorHandler.js";
import { requireEnv } from "@/shared/env.js";
import type {
  AttentionStockCriteriaDetail,
  AttentionStockEntry,
  AttentionStocksResult,
  DisposedStockEntry,
  DisposedStocksResult,
  EtfAssetClass,
  EtfDistributionFrequency,
  EtfRankingEntry,
  EtfRankingMetric,
  EtfRankingResult,
  ForeignHoldingRankingEntry,
  ForeignHoldingRankingResult,
  Market,
  MarginShortRatioRankingEntry,
  MarginShortRatioRankingResult,
  MaterialAnnouncementEntry,
  MaterialAnnouncementsResult,
  PriceChangeRankingEntry,
  PriceChangeRankingResult,
  PriceLimitRangeEntry,
  PriceLimitRangeResult,
  RankingOrder,
  RevenueRankingEntry,
  RevenueRankingMetric,
  RevenueRankingResult,
  VolumeTop20Entry,
  VolumeTop20Result,
} from "@/domains/market/market.types.js";

/** "" means "no data yet" (see ForeignHoldingRankingResult) — normalized to null, a clearer signal than an empty string. */
function toDateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return value;
}

/**
 * Ratio/percentage fields (Decimal-backed) come back from analysis-ts as JSON numbers — their real,
 * existing convention (confirmed with them directly, see analysisScreenerClient.ts's normalizeValues
 * for the same pattern) — normalized to strings here so bff-ts's own outward API stays consistent with
 * every other numeric value it returns. Raw balance/share-count fields are already strings on their side
 * (BigInt-backed), but String() is a safe no-op if a small value ever comes back as a number instead.
 */
function toStringOrEmpty(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Unlike toStringOrEmpty, null here is a meaningful signal (a TPEx row missing a TWSE-only field — see
 * market.types.ts's per-endpoint notes) that must survive as null, not collapse into an empty string.
 */
function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Only "TWSE"/"TPEx" are documented — anything else defaults to "TWSE" rather than throwing. */
function normalizeMarket(value: unknown): Market {
  return value === "TPEx" ? "TPEx" : "TWSE";
}

function normalizeForeignHoldingEntry(raw: unknown): ForeignHoldingRankingEntry {
  const r = raw as Record<string, unknown>;
  return {
    symbol: String(r.symbol),
    name: typeof r.companyName === "string" ? r.companyName : null,
    sharesHeldPercent: toStringOrEmpty(r.sharesHeldPercent),
    previousSharesHeldPercent: toStringOrEmpty(r.previousSharesHeldPercent),
    changePercentagePoints: toStringOrEmpty(r.changePercentagePoints),
    sharesHeld: toStringOrEmpty(r.sharesHeld),
  };
}

function normalizeMarginShortRatioEntry(raw: unknown): MarginShortRatioRankingEntry {
  const r = raw as Record<string, unknown>;
  return {
    rank: Number(r.rank),
    symbol: String(r.symbol),
    name: typeof r.companyName === "string" ? r.companyName : null,
    shortToMarginRatioPct: toStringOrEmpty(r.shortToMarginRatioPct),
    marginTodayBalance: toStringOrEmpty(r.marginTodayBalance),
    shortTodayBalance: toStringOrEmpty(r.shortTodayBalance),
  };
}

function normalizeMaterialAnnouncementEntry(raw: unknown): MaterialAnnouncementEntry {
  const r = raw as Record<string, unknown>;
  return {
    symbol: String(r.symbol),
    name: typeof r.companyName === "string" ? r.companyName : null,
    announcementDate: toStringOrEmpty(r.announcementDate),
    announcementTime: toStringOrEmpty(r.announcementTime),
    reportDate: toStringOrEmpty(r.reportDate),
    subject: toStringOrEmpty(r.subject),
    clause: toStringOrEmpty(r.clause),
    factDate: toStringOrEmpty(r.factDate),
    description: toStringOrEmpty(r.description),
  };
}

function normalizeRevenueRankingEntry(raw: unknown): RevenueRankingEntry {
  const r = raw as Record<string, unknown>;
  return {
    rank: Number(r.rank),
    symbol: String(r.symbol),
    name: typeof r.companyName === "string" ? r.companyName : null,
    market: normalizeMarket(r.market),
    currentMonthRevenue: toStringOrEmpty(r.currentMonthRevenue),
    momChangePercent: toStringOrNull(r.momChangePercent),
    yoyChangePercent: toStringOrNull(r.yoyChangePercent),
  };
}

function normalizeVolumeTop20Entry(raw: unknown): VolumeTop20Entry {
  const r = raw as Record<string, unknown>;
  return {
    rank: Number(r.rank),
    symbol: String(r.symbol),
    name: typeof r.companyName === "string" ? r.companyName : null,
    market: normalizeMarket(r.market),
    volume: toStringOrEmpty(r.volume),
    transaction: toStringOrNull(r.transaction),
    open: toStringOrNull(r.open),
    high: toStringOrNull(r.high),
    low: toStringOrNull(r.low),
    close: toStringOrNull(r.close),
    dir: toStringOrNull(r.dir),
    change: toStringOrNull(r.change),
    changePercent: toStringOrNull(r.changePercent),
  };
}

function normalizeDisposedStockEntry(raw: unknown): DisposedStockEntry {
  const r = raw as Record<string, unknown>;
  return {
    symbol: String(r.symbol),
    name: typeof r.companyName === "string" ? r.companyName : null,
    market: normalizeMarket(r.market),
    announceDate: toStringOrEmpty(r.announceDate),
    announcementCount: typeof r.announcementCount === "number" ? r.announcementCount : null,
    reason: toStringOrEmpty(r.reason),
    reasonTimes: typeof r.reasonTimes === "number" ? r.reasonTimes : null,
    reasonShort: typeof r.reasonShort === "string" ? r.reasonShort : null,
    dispositionPeriod: toStringOrEmpty(r.dispositionPeriod),
    dispositionStartDate: toStringOrEmpty(r.dispositionStartDate),
    dispositionEndDate: toStringOrEmpty(r.dispositionEndDate),
    dispositionMeasures: toStringOrNull(r.dispositionMeasures),
    detail: toStringOrEmpty(r.detail),
    linkInformation: toStringOrNull(r.linkInformation),
    sixDayChangePercent: toStringOrNull(r.sixDayChangePercent),
  };
}

function normalizeAttentionStockCriteriaDetail(raw: unknown): AttentionStockCriteriaDetail {
  const r = raw as Record<string, unknown>;
  return {
    startDate: toStringOrEmpty(r.startDate),
    endDate: toStringOrEmpty(r.endDate),
    observationDays: typeof r.observationDays === "number" ? r.observationDays : null,
    times: Number(r.times),
  };
}

function normalizeAttentionStockEntry(raw: unknown): AttentionStockEntry {
  const r = raw as Record<string, unknown>;
  return {
    symbol: String(r.symbol),
    name: typeof r.companyName === "string" ? r.companyName : null,
    market: normalizeMarket(r.market),
    tradeDate: toStringOrEmpty(r.tradeDate),
    criteria: toStringOrEmpty(r.criteria),
    criteriaDetails: Array.isArray(r.criteriaDetails) ? r.criteriaDetails.map(normalizeAttentionStockCriteriaDetail) : [],
    sixDayChangePercent: toStringOrNull(r.sixDayChangePercent),
  };
}

function normalizePriceLimitRangeEntry(raw: unknown): PriceLimitRangeEntry {
  const r = raw as Record<string, unknown>;
  return {
    rank: Number(r.rank),
    symbol: String(r.symbol),
    name: typeof r.companyName === "string" ? r.companyName : null,
    market: normalizeMarket(r.market),
    limitUp: toStringOrEmpty(r.limitUp),
    limitDown: toStringOrEmpty(r.limitDown),
    limitRange: toStringOrEmpty(r.limitRange),
    openingRefPrice: toStringOrNull(r.openingRefPrice),
    previousDayPrice: toStringOrNull(r.previousDayPrice),
    allowOddLotTrade: toStringOrNull(r.allowOddLotTrade),
  };
}

function normalizePriceChangeRankingEntry(raw: unknown): PriceChangeRankingEntry {
  const r = raw as Record<string, unknown>;
  return {
    rank: Number(r.rank),
    symbol: String(r.symbol),
    name: typeof r.companyName === "string" ? r.companyName : null,
    market: normalizeMarket(r.market),
    tradeDate: toStringOrEmpty(r.tradeDate),
    previousTradeDate: toStringOrEmpty(r.previousTradeDate),
    close: toStringOrEmpty(r.close),
    previousClose: toStringOrEmpty(r.previousClose),
    changeAmount: toStringOrEmpty(r.changeAmount),
    changePercent: toStringOrEmpty(r.changePercent),
  };
}

function normalizeEtfRankingEntry(raw: unknown): EtfRankingEntry {
  const r = raw as Record<string, unknown>;
  return {
    rank: Number(r.rank),
    symbol: String(r.symbol),
    fundName: toStringOrEmpty(r.fundName),
    shortName: toStringOrEmpty(r.shortName),
    issuerName: typeof r.companyName === "string" ? r.companyName : null,
    category: toStringOrEmpty(r.category),
    market: normalizeMarket(r.market),
    assetClass: typeof r.assetClass === "string" ? (r.assetClass as EtfAssetClass) : null,
    isActive: r.isActive === true,
    distributionFrequency: typeof r.distributionFrequency === "string" ? (r.distributionFrequency as EtfDistributionFrequency) : null,
    value: toStringOrEmpty(r.value),
    asOf: toStringOrEmpty(r.asOf),
  };
}

async function getJson(path: string, searchParams: Record<string, string>): Promise<unknown> {
  const url = new URL(path, requireEnv("FILTERS_SERVICE_URL"));
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new AppError(
      `Could not reach the analysis service at ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }

  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    throw new AppError(typeof message === "string" ? message : `Invalid request to ${url.toString()}`, 400);
  }
  if (!response.ok) {
    throw new AppError(`Market ranking endpoint returned ${response.status} for ${url.toString()}`, 502);
  }
  return response.json();
}

/**
 * Foreign-holding increase/decrease ranking from analysis-ts's GET /market/foreign-holding-ranking —
 * compares the two most recent trading days' `sharesHeldPercent` (percentage of issued shares, not raw
 * share count, so capital increases/decreases don't distort the ranking), sorted by percentage-point
 * change. Both ETFs/derivatives and (currently) any symbol without two comparable days are excluded on
 * analysis-ts's side.
 *
 * `limit` (top N rows per direction) replaced the endpoint's original `topPercent` (top N% after sorting)
 * param as of 2026-09-01 — analysis-ts switched their own query semantics to a fixed row count, matching
 * margin-short-ratio-ranking's convention, so bff-ts's param/field naming follows suit here too.
 */
export async function fetchForeignHoldingRanking(limit: number): Promise<ForeignHoldingRankingResult> {
  const body = (await getJson("/market/foreign-holding-ranking", { limit: String(limit) })) as {
    tradeDate?: unknown;
    previousTradeDate?: unknown;
    limit?: unknown;
    eligibleCompanyCount?: unknown;
    increases?: unknown;
    decreases?: unknown;
    warnings?: unknown;
  };

  if (
    typeof body.limit !== "number" ||
    typeof body.eligibleCompanyCount !== "number" ||
    !Array.isArray(body.increases) ||
    !Array.isArray(body.decreases)
  ) {
    throw new AppError("Foreign holding ranking response is missing expected fields", 502);
  }

  return {
    tradeDate: toDateOrNull(body.tradeDate),
    previousTradeDate: toDateOrNull(body.previousTradeDate),
    limit: body.limit,
    eligibleCompanyCount: body.eligibleCompanyCount,
    increases: body.increases.map(normalizeForeignHoldingEntry),
    decreases: body.decreases.map(normalizeForeignHoldingEntry),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}

/**
 * Margin/short ratio ranking (short-sale balance ÷ margin-purchase balance × 100) from analysis-ts's
 * GET /market/margin-short-ratio-ranking — a higher ratio signals more short-squeeze potential. Companies
 * with a zero margin balance or no short-sale data are excluded outright on analysis-ts's side (never
 * treated as 0 or Infinity). ETFs/derivatives are also excluded there.
 */
export async function fetchMarginShortRatioRanking(limit: number): Promise<MarginShortRatioRankingResult> {
  const body = (await getJson("/market/margin-short-ratio-ranking", { limit: String(limit) })) as {
    tradeDate?: unknown;
    limit?: unknown;
    rankings?: unknown;
    warnings?: unknown;
  };

  if (typeof body.limit !== "number" || !Array.isArray(body.rankings)) {
    throw new AppError("Margin/short ratio ranking response is missing expected fields", 502);
  }

  return {
    tradeDate: toDateOrNull(body.tradeDate),
    limit: body.limit,
    rankings: body.rankings.map(normalizeMarginShortRatioEntry),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}

/**
 * 上市公司重大訊息公告 from analysis-ts's GET /market/material-announcements — newest announcement date
 * first. Unlike this file's other endpoints, twse-ts's schedule for this dataset has been stable for a
 * while, so prod already has real data (confirmed live: 254 rows) — no deploy wait needed here.
 */
export async function fetchMaterialAnnouncements(limit: number): Promise<MaterialAnnouncementsResult> {
  const body = (await getJson("/market/material-announcements", { limit: String(limit) })) as {
    limit?: unknown;
    items?: unknown;
    warnings?: unknown;
  };

  if (typeof body.limit !== "number" || !Array.isArray(body.items)) {
    throw new AppError("Material announcements response is missing expected fields", 502);
  }

  return {
    limit: body.limit,
    items: body.items.map(normalizeMaterialAnnouncementEntry),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}

/**
 * Monthly revenue ranking (月營收排行) from analysis-ts's GET /market/revenue-ranking — `metric` picks
 * the sort basis (yoy/mom/revenue), TWSE+TPEx merged as of 2026-09-01. `metric`/`order` are both required
 * upstream (no default) — bff-ts mirrors that, see market.routes.ts's requireStringQueryParam.
 */
export async function fetchRevenueRanking(
  metric: RevenueRankingMetric,
  order: RankingOrder,
  limit: number,
): Promise<RevenueRankingResult> {
  const body = (await getJson("/market/revenue-ranking", { metric, order, limit: String(limit) })) as {
    yearMonth?: unknown;
    metric?: unknown;
    order?: unknown;
    limit?: unknown;
    rankings?: unknown;
    warnings?: unknown;
  };

  if (
    typeof body.yearMonth !== "string" ||
    typeof body.metric !== "string" ||
    typeof body.order !== "string" ||
    typeof body.limit !== "number" ||
    !Array.isArray(body.rankings)
  ) {
    throw new AppError("Revenue ranking response is missing expected fields", 502);
  }

  return {
    yearMonth: body.yearMonth,
    metric: body.metric as RevenueRankingMetric,
    order: body.order as RankingOrder,
    limit: body.limit,
    rankings: body.rankings.map(normalizeRevenueRankingEntry),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}

/**
 * Top 20 by trading volume (成交量前20) from analysis-ts's GET /market/volume-top20 — no query params,
 * always exactly 20 (data permitting). Deliberately does NOT exclude ETFs/derivatives, unlike this file's
 * other ranking endpoints (confirmed with analysis-ts directly).
 */
export async function fetchVolumeTop20(): Promise<VolumeTop20Result> {
  const body = (await getJson("/market/volume-top20", {})) as { tradeDate?: unknown; rankings?: unknown };

  if (!Array.isArray(body.rankings)) {
    throw new AppError("Volume top20 response is missing expected fields", 502);
  }

  return {
    tradeDate: toDateOrNull(body.tradeDate),
    rankings: body.rankings.map(normalizeVolumeTop20Entry),
  };
}

/** 處置股清單 (disposed stocks) from analysis-ts's GET /market/disposed-stocks — newest announcement first. */
export async function fetchDisposedStocks(limit: number): Promise<DisposedStocksResult> {
  const body = (await getJson("/market/disposed-stocks", { limit: String(limit) })) as {
    limit?: unknown;
    items?: unknown;
    warnings?: unknown;
  };

  if (typeof body.limit !== "number" || !Array.isArray(body.items)) {
    throw new AppError("Disposed stocks response is missing expected fields", 502);
  }

  return {
    limit: body.limit,
    items: body.items.map(normalizeDisposedStockEntry),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}

/** 注意股清單 (attention stocks) from analysis-ts's GET /market/attention-stocks — newest trade date first. */
export async function fetchAttentionStocks(limit: number): Promise<AttentionStocksResult> {
  const body = (await getJson("/market/attention-stocks", { limit: String(limit) })) as {
    limit?: unknown;
    items?: unknown;
    warnings?: unknown;
  };

  if (typeof body.limit !== "number" || !Array.isArray(body.items)) {
    throw new AppError("Attention stocks response is missing expected fields", 502);
  }

  return {
    limit: body.limit,
    items: body.items.map(normalizeAttentionStockEntry),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}

/**
 * Widest/narrowest daily price-limit-range movers from analysis-ts's GET /market/price-limit-range — no
 * query params, 20 rows each direction (data permitting).
 */
export async function fetchPriceLimitRange(): Promise<PriceLimitRangeResult> {
  const body = (await getJson("/market/price-limit-range", {})) as {
    tradeDate?: unknown;
    widest?: unknown;
    narrowest?: unknown;
  };

  if (!Array.isArray(body.widest) || !Array.isArray(body.narrowest)) {
    throw new AppError("Price limit range response is missing expected fields", 502);
  }

  return {
    tradeDate: toDateOrNull(body.tradeDate),
    widest: body.widest.map(normalizePriceLimitRangeEntry),
    narrowest: body.narrowest.map(normalizePriceLimitRangeEntry),
  };
}

/**
 * 漲跌幅排行 (gainers/losers) from analysis-ts's GET /market/price-change-ranking — computed from
 * daily_price (already a full-market mirror), not a twse-ts/tpex-ts export dataset, so real data exists
 * from day one (added 2026-09-02, no deploy wait needed). TWSE and TPEx each use their own latest two
 * trading days, so `tradeDate`/`previousTradeDate` live per-row, not at the top level.
 */
export async function fetchPriceChangeRanking(limit: number): Promise<PriceChangeRankingResult> {
  const body = (await getJson("/market/price-change-ranking", { limit: String(limit) })) as {
    limit?: unknown;
    gainers?: unknown;
    losers?: unknown;
    warnings?: unknown;
  };

  if (typeof body.limit !== "number" || !Array.isArray(body.gainers) || !Array.isArray(body.losers)) {
    throw new AppError("Price change ranking response is missing expected fields", 502);
  }

  return {
    limit: body.limit,
    gainers: body.gainers.map(normalizePriceChangeRankingEntry),
    losers: body.losers.map(normalizePriceChangeRankingEntry),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}

/**
 * ETF ranking from analysis-ts's GET /market/etf-ranking — the first endpoint backed by sitca-ts data.
 * `metric`/`order` are both required upstream (no default), same as fetchRevenueRanking. See
 * market.types.ts's EtfRankingEntry for what each metric means and the expenseRatio base-year caveat.
 */
export async function fetchEtfRanking(
  metric: EtfRankingMetric,
  order: RankingOrder,
  limit: number,
): Promise<EtfRankingResult> {
  const body = (await getJson("/market/etf-ranking", { metric, order, limit: String(limit) })) as {
    metric?: unknown;
    order?: unknown;
    limit?: unknown;
    rankings?: unknown;
    warnings?: unknown;
  };

  if (
    typeof body.metric !== "string" ||
    typeof body.order !== "string" ||
    typeof body.limit !== "number" ||
    !Array.isArray(body.rankings)
  ) {
    throw new AppError("ETF ranking response is missing expected fields", 502);
  }

  return {
    metric: body.metric as EtfRankingMetric,
    order: body.order as RankingOrder,
    limit: body.limit,
    rankings: body.rankings.map(normalizeEtfRankingEntry),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
  };
}
