import { getCompanyNames } from "@/domains/companies/index.js";
import { findFilterFields } from "@/domains/filterCatalog/index.js";
import { getLatestClosePrices } from "@/domains/stock/index.js";
import { AppError } from "@/shared/errorHandler.js";
import { parseFieldRef, toFieldRefString } from "@/shared/fieldRef.js";
import {
  fetchScreenerRanking,
  fetchScreenerResults,
  fetchScreenerValues,
  type ScreenerSort,
} from "@/domains/screener/analysisScreenerClient.js";
import { SPECIAL_COLUMNS } from "@/domains/screener/columnField.js";
import type { Pagination } from "@/domains/screener/pagination.js";
import type {
  ScreenerColumnRef,
  ScreenerFilter,
  ScreenerResult,
  ScreenerResultColumn,
  ScreenerResultRow,
  ScreenerValuesResult,
} from "@/domains/screener/screener.types.js";
import { fetchValuationRanking, type ValuationRankingMetric } from "@/domains/screener/valuationRanking.client.js";

const STOCK_PRICE_FIELD = "stock.price";

/**
 * Ranking is a second-order computation over raw market data, not something this BFF should own —
 * oingg-analysis-ts's GET /valuation/ranking already does it (sort, limit, exclude non-positive P/E or
 * P/B), covering both TWSE and TPEx. These three fields go there (see valuationRanking.client.ts)
 * instead of the general screener path below — this override is ranking-only.
 */
const VALUATION_RANKING_FIELDS: Record<string, ValuationRankingMetric> = {
  "per.peRatio": "peRatio",
  "pbr.pbRatio": "pbRatio",
  "dividendYield.dividendYieldPct": "dividendYield",
};

interface ResolvedRef {
  metricKey: string;
  fieldKey: string;
  field: string;
  metricName: string;
  fieldName: string;
  unit: string | null;
}

/**
 * Resolves filterCatalog fields against bff-ts's own synced catalog — used for filters, and for catalog
 * display columns (to attach metricName/fieldName in the response; the actual query now runs on
 * analysis-ts's side, see analysisScreenerClient.ts). Looks all of them up in a single batched query
 * rather than one query per field.
 *
 * Used to also check the field against ANALYSIS_METRIC_TABLES and 501 if the metric wasn't wired up to
 * a real analysis-DB table yet — removed 2026-09-01 along with the rest of the direct-DB query building
 * (buildMetricCtes/toSnakeCase/ROC-year conversion, etc.): analysis-ts's POST /screener/GET
 * /screener/ranking now cover the entire /filters catalog by construction, so there's no "not wired up
 * yet" case left on bff-ts's side. An unknown field is still a 400 here (fails fast against the local
 * catalog cache, same message as always, without a round trip to analysis-ts).
 */
async function resolveCatalogFieldRefs(fields: string[]): Promise<ResolvedRef[]> {
  const refs = fields.map((field) => ({ field, ...parseFieldRef(field) }));
  const found = await findFilterFields(refs);
  const foundByKey = new Map(found.map((f) => [toFieldRefString(f.metricKey, f.fieldKey), f]));

  return refs.map((ref) => {
    const lookup = foundByKey.get(toFieldRefString(ref.metricKey, ref.fieldKey));
    if (!lookup) {
      throw new AppError(`Unknown filter field "${ref.field}"`, 400);
    }
    return {
      metricKey: ref.metricKey,
      fieldKey: ref.fieldKey,
      field: ref.field,
      metricName: lookup.metricName,
      fieldName: lookup.fieldName,
      unit: lookup.unit,
    };
  });
}

/** Shared by runScreener/runRanking: merges "stock.price" (twse/tpex, not the analysis DB) into result rows. */
async function mergeStockPrices(rows: ScreenerResultRow[], wantsStockPrice: boolean): Promise<void> {
  if (!wantsStockPrice) {
    return;
  }
  const pricesBySymbol = await getLatestClosePrices(rows.map((row) => row.symbol));
  for (const row of rows) {
    const price = pricesBySymbol.get(row.symbol);
    row.values[STOCK_PRICE_FIELD] = { value: price?.close ?? null, asOfDate: price?.tradeDate ?? null };
  }
}

/**
 * Shared by runScreener/runRanking/runValuationRanking: attaches each row's display name — always, not
 * gated behind a requested column, since a name is expected on every result regardless of which fields
 * the caller chose to display. See companies.service.ts's getCompanyNames for why this is a live
 * per-request lookup with nothing cached on our side.
 */
async function mergeCompanyNames(rows: ScreenerResultRow[]): Promise<void> {
  const namesBySymbol = await getCompanyNames(rows.map((row) => row.symbol));
  for (const row of rows) {
    row.name = namesBySymbol.get(row.symbol) ?? null;
  }
}

/**
 * `sortField` must be "symbol" or one of this request's own display `columns` — never "stock.price"
 * (twse/tpex, not part of analysis-ts's data at all) and never an arbitrary filter-only field the caller
 * didn't also ask to display. analysis-ts sorts the full result set before pagination (not just the
 * returned page), adding `symbol` as an internal tiebreaker for stable pagination when the sort field has
 * duplicate values.
 */
function validateSort(sort: ScreenerSort | undefined, resolvedColumns: ResolvedRef[]): void {
  if (!sort) {
    return;
  }
  if (sort.field !== "symbol" && !resolvedColumns.some((c) => c.field === sort.field)) {
    throw new AppError(
      `"sortField" must be "symbol" or one of this request's own columns — "${sort.field}" isn't in "columns"`,
      400,
    );
  }
}

/**
 * Screens companies by filterCatalog metrics — the actual query (dynamic CTE/JOIN across 30+ metric
 * tables, latest-row-per-symbol, ROC-year quarter labels, null/exclude filter semantics, sorting) now
 * runs on analysis-ts's own POST /screener (see analysisScreenerClient.ts and
 * docs/直連DB反模式修復計畫.md for what moved and why). This function's remaining job is: validate/resolve
 * fields against bff-ts's own synced catalog (for metricName/fieldName in the response — analysis-ts's
 * endpoint doesn't echo those back, we already have them locally), split off "stock.price" (twse/tpex,
 * not part of the filterCatalog at all), delegate the rest, then merge stock.price and company names in.
 *
 * Requires at least one filter — an empty-filters "list everything" mode isn't supported (bff-ts's own
 * long-standing rule, independent of what analysis-ts's engine can technically do).
 */
export async function runScreener(
  filters: ScreenerFilter[],
  columns: ScreenerColumnRef[],
  pagination: Pagination,
  sort?: ScreenerSort,
): Promise<ScreenerResult> {
  if (filters.length === 0) {
    throw new AppError("At least one filter is required", 400);
  }

  const specialColumns = columns.filter((c) => c.field in SPECIAL_COLUMNS);
  const catalogColumnRefs = columns.filter((c) => !(c.field in SPECIAL_COLUMNS));

  const allRefs = await resolveCatalogFieldRefs([
    ...filters.map((f) => f.field),
    ...catalogColumnRefs.map((c) => c.field),
  ]);
  const resolvedColumns = allRefs.slice(filters.length);
  validateSort(sort, resolvedColumns);

  const apiResult = await fetchScreenerResults(
    filters,
    resolvedColumns.map((c) => ({ field: c.field })),
    pagination,
    sort,
  );

  const wantsStockPrice = specialColumns.some((c) => c.field === STOCK_PRICE_FIELD);

  const resultColumns: ScreenerResultColumn[] = resolvedColumns.map((c) => ({
    field: c.field,
    metricName: c.metricName,
    fieldName: c.fieldName,
    unit: c.unit,
  }));
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  const results: ScreenerResultRow[] = apiResult.results.map((row) => ({
    symbol: row.symbol,
    name: null,
    values: row.values,
  }));
  // Independent of each other (different fields on each row) - run concurrently instead of
  // sequentially, each is its own round trip (mergeStockPrices to analysis-ts, mergeCompanyNames to
  // our own local Company cache).
  await Promise.all([mergeStockPrices(results, wantsStockPrice), mergeCompanyNames(results)]);

  return {
    count: apiResult.count,
    page: apiResult.page,
    pageSize: apiResult.pageSize,
    totalPages: apiResult.totalPages,
    columns: resultColumns,
    results,
  };
}

// Matches bff-ts's own screener pageSize cap (see pagination.ts's MAX_PAGE_SIZE) — this endpoint's
// real use case is "the symbols on my current page", which never gets close to either limit.
const MAX_VALUES_SYMBOLS = 200;

/**
 * Fetches just the requested columns for an explicit, already-known list of symbols — used when the
 * frontend adds a new column to an already-loaded/paginated result set, so it doesn't need to re-run the
 * full filtered query (and re-fetch every column it already has) just to pick up one more field. No
 * filters, no pagination: the caller already knows which symbols it wants. Every requested symbol gets a
 * result row (even if analysis-ts has no data for it, with empty `values`) — this never silently drops a
 * row the caller already has on screen.
 */
export async function runScreenerValues(symbols: string[], columns: ScreenerColumnRef[]): Promise<ScreenerValuesResult> {
  if (symbols.length === 0) {
    throw new AppError("At least one symbol is required", 400);
  }
  if (symbols.length > MAX_VALUES_SYMBOLS) {
    throw new AppError(`At most ${MAX_VALUES_SYMBOLS} symbols are allowed per request`, 400);
  }
  if (columns.length === 0) {
    throw new AppError("At least one column is required", 400);
  }

  const specialColumns = columns.filter((c) => c.field in SPECIAL_COLUMNS);
  const catalogColumnRefs = columns.filter((c) => !(c.field in SPECIAL_COLUMNS));

  const resolvedColumns = await resolveCatalogFieldRefs(catalogColumnRefs.map((c) => c.field));

  const apiResult = await fetchScreenerValues(
    symbols,
    resolvedColumns.map((c) => ({ field: c.field })),
  );

  const wantsStockPrice = specialColumns.some((c) => c.field === STOCK_PRICE_FIELD);

  const resultColumns: ScreenerResultColumn[] = resolvedColumns.map((c) => ({
    field: c.field,
    metricName: c.metricName,
    fieldName: c.fieldName,
    unit: c.unit,
  }));
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  const rowBySymbol = new Map(apiResult.results.map((row) => [row.symbol, row]));
  const results: ScreenerResultRow[] = symbols.map((symbol) => ({
    symbol,
    name: null,
    values: rowBySymbol.get(symbol)?.values ?? {},
  }));
  // Independent of each other (different fields on each row) - run concurrently instead of
  // sequentially, each is its own round trip (mergeStockPrices to analysis-ts, mergeCompanyNames to
  // our own local Company cache).
  await Promise.all([mergeStockPrices(results, wantsStockPrice), mergeCompanyNames(results)]);

  return { count: results.length, columns: resultColumns, results };
}

export interface RankingResult {
  field: string;
  direction: "asc" | "desc";
  columns: ScreenerResultColumn[];
  results: ScreenerResultRow[];
}

/**
 * Top-N ranking by a single metric (e.g. "highest dividend yield", "lowest P/E") — for homepage cards,
 * not the full screener. The ranked field always comes back in each row's values from analysis-ts's
 * GET /screener/ranking (their deliberate asymmetry vs. POST /screener, confirmed with them directly),
 * so unlike runScreener we don't need to explicitly pass it as a column — only the caller's extra
 * display columns (which may include "stock.price") go through as `columns`.
 */
export async function runRanking(
  field: string,
  direction: "asc" | "desc",
  limit: number,
  columns: ScreenerColumnRef[],
): Promise<RankingResult> {
  const valuationMetric = VALUATION_RANKING_FIELDS[field];
  if (valuationMetric) {
    return runValuationRanking(field, valuationMetric, direction, limit, columns);
  }

  const specialColumns = columns.filter((c) => c.field in SPECIAL_COLUMNS);
  const catalogColumnRefs = columns.filter((c) => !(c.field in SPECIAL_COLUMNS) && c.field !== field);

  const allRefs = await resolveCatalogFieldRefs([field, ...catalogColumnRefs.map((c) => c.field)]);
  const [rankedRef, ...extraColumnRefs] = allRefs as [ResolvedRef, ...ResolvedRef[]];
  const allColumnRefs = [rankedRef, ...extraColumnRefs];

  const apiResult = await fetchScreenerRanking(
    field,
    direction,
    limit,
    extraColumnRefs.map((c) => ({ field: c.field })),
  );

  const wantsStockPrice = specialColumns.some((c) => c.field === STOCK_PRICE_FIELD);
  const resultColumns: ScreenerResultColumn[] = allColumnRefs.map((c) => ({
    field: c.field,
    metricName: c.metricName,
    fieldName: c.fieldName,
    unit: c.unit,
  }));
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  const results: ScreenerResultRow[] = apiResult.results.map((row) => ({
    symbol: row.symbol,
    name: null,
    values: row.values,
  }));
  // Independent of each other (different fields on each row) - run concurrently instead of
  // sequentially, each is its own round trip (mergeStockPrices to analysis-ts, mergeCompanyNames to
  // our own local Company cache).
  await Promise.all([mergeStockPrices(results, wantsStockPrice), mergeCompanyNames(results)]);

  return { field, direction, columns: resultColumns, results };
}

/**
 * The oingg-analysis-ts-backed ranking path for per.peRatio/pbr.pbRatio/dividendYield.dividendYieldPct —
 * see VALUATION_RANKING_FIELDS. Only "stock.price" can be combined with it as an extra column: any other
 * field would need a join this path deliberately doesn't do (that's what the general ranking path above,
 * or the full /screener endpoint, is for).
 */
async function runValuationRanking(
  field: string,
  metric: ValuationRankingMetric,
  direction: "asc" | "desc",
  limit: number,
  columns: ScreenerColumnRef[],
): Promise<RankingResult> {
  const unsupportedColumn = columns.find((c) => c.field !== STOCK_PRICE_FIELD);
  if (unsupportedColumn) {
    throw new AppError(
      `"${unsupportedColumn.field}" can't be combined with a "${field}" ranking (sourced from ` +
        `oingg-analysis-ts's ranking endpoint, not the general screener path) — only "stock.price" ` +
        `is supported alongside it`,
      400,
    );
  }

  const [rankedRef] = await resolveCatalogFieldRefs([field]);
  const { tradeDate, rankings } = await fetchValuationRanking(metric, direction, limit);
  const wantsStockPrice = columns.some((c) => c.field === STOCK_PRICE_FIELD);

  const results: ScreenerResultRow[] = rankings.map((row) => ({
    symbol: row.symbol,
    name: null,
    values: { [field]: { value: String(row.value), asOfDate: tradeDate } },
  }));
  // Independent of each other (different fields on each row) - run concurrently instead of
  // sequentially, each is its own round trip (mergeStockPrices to analysis-ts, mergeCompanyNames to
  // our own local Company cache).
  await Promise.all([mergeStockPrices(results, wantsStockPrice), mergeCompanyNames(results)]);

  const resultColumns: ScreenerResultColumn[] = [
    { field, metricName: rankedRef!.metricName, fieldName: rankedRef!.fieldName, unit: rankedRef!.unit },
  ];
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  return { field, direction, columns: resultColumns, results };
}
