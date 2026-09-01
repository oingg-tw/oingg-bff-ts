import { queryNeon } from "../../adapters/neon/index.js";
import { getCompanyNames } from "../companies/index.js";
import { findFilterFields } from "../filterCatalog/index.js";
import { getLatestClosePrices } from "../stock/index.js";
import { AppError } from "../../shared/errorHandler.js";
import { parseFieldRef, toFieldRefString } from "../../shared/fieldRef.js";
import { ANALYSIS_METRIC_TABLES } from "./analysisMetricTables.js";
import { SPECIAL_COLUMNS } from "./columnField.js";
import type { Pagination } from "./pagination.js";
import type {
  ScreenerColumnRef,
  ScreenerFilter,
  ScreenerResult,
  ScreenerResultColumn,
  ScreenerResultRow,
} from "./screener.types.js";
import { fetchValuationRanking, type ValuationRankingMetric } from "./valuationRanking.client.js";

const ANALYSIS_DB = "analysis";
const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const STOCK_PRICE_FIELD = "stock.price";

/**
 * Ranking is a second-order computation over raw market data, not something this BFF should own —
 * oingg-analysis-ts's GET /valuation/ranking already does it (sort, limit, exclude non-positive P/E or
 * P/B), covering both TWSE and TPEx. These three fields go there (see valuationRanking.client.ts)
 * instead of the analysis DB's `valuation_market_ratios` (only lazily populated per-symbol, currently
 * just a couple of symbols — the wrong table for a whole-market ranking regardless). Filtering/combining
 * these fields with OTHER analysis-DB metrics in the general screener still goes through the normal
 * analysis-DB path below — this override is ranking-only.
 */
const VALUATION_RANKING_FIELDS: Record<string, ValuationRankingMetric> = {
  "per.peRatio": "peRatio",
  "pbr.pbRatio": "pbRatio",
  "dividendYield.dividendYieldPct": "dividendYield",
};

/**
 * Converts a filterCatalog field key to its analysis-DB column name. A plain "insert _ before every
 * uppercase letter" rule breaks on keys like "beta1Y" (a number immediately followed by an uppercase
 * unit letter, e.g. "1Y" = 1-year) — that gives "beta1_y", but the real column is "beta_1y" (found via
 * real DB verification when wiring up the `beta` metric). analysis-ts's convention treats a
 * digit+uppercase-letter suffix like "1Y"/"5D" as one glued unit that just lowercases in place, with the
 * underscore going before the digit instead of before the uppercase letter.
 */
function toSnakeCase(camelCase: string): string {
  return camelCase
    .replace(/([a-z])(\d)/g, "$1_$2")
    .replace(/(?<!\d)[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function toSafeColumn(fieldKey: string): string {
  const column = toSnakeCase(fieldKey);
  if (!SAFE_IDENTIFIER.test(column)) {
    throw new AppError(`Field "${fieldKey}" doesn't map to a safe column name`, 500);
  }
  return column;
}

interface ResolvedRef {
  metricKey: string;
  fieldKey: string;
  field: string;
  column: string;
  metricName: string;
  fieldName: string;
  asOfFormat: "date" | "quarter";
}

/**
 * Resolves filterCatalog fields (analysis DB only) — used for filters, and for catalog display columns.
 * Looks all of them up in a single batched query rather than one query per field: a screener call with
 * several filters and display columns used to fire one findFilterField round trip per field.
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
    const table = ANALYSIS_METRIC_TABLES[ref.metricKey];
    if (!table) {
      throw new AppError(`Metric "${ref.metricKey}" isn't wired up to the analysis database yet`, 501);
    }
    return {
      metricKey: ref.metricKey,
      fieldKey: ref.fieldKey,
      field: ref.field,
      column: toSafeColumn(ref.fieldKey),
      metricName: lookup.metricName,
      fieldName: lookup.fieldName,
      asOfFormat: table.asOfFormat ?? "date",
    };
  });
}

interface ResolvedFilter extends ResolvedRef {
  min: number | null;
  max: number | null;
  exclude: boolean;
}

const cteAlias = (metricKey: string) => `m_${metricKey}`;
const AS_OF_DATE_COLUMN = "__as_of_date";
const AS_OF_YEAR_COLUMN = "__as_of_year";
const AS_OF_SEASON_COLUMN = "__as_of_season";
const asOfDateAlias = (field: string) => `${field}__asOfDate`;
const asOfYearAlias = (field: string) => `${field}__asOfYear`;
const asOfSeasonAlias = (field: string) => `${field}__asOfSeason`;

function toDateString(date: unknown): string | null {
  if (date instanceof Date) {
    return date.toISOString().slice(0, 10);
  }
  return typeof date === "string" ? date.slice(0, 10) : null;
}

// oingg-analysis-ts's quarterly tables store `year` as the ROC/Minguo calendar year (民國年), not
// Gregorian — verified against the real DB: profitability_roe has year=115 for report_date 2026-06-29
// (115 + 1911 = 2026). Naively slicing the last 2 digits of the raw column gives "15Q2" instead of the
// intended "26Q2" — must convert to Gregorian first.
const ROC_TO_GREGORIAN_OFFSET = 1911;

/** ROC year 115, season 2 -> "26Q2". Built from the row's own year/season integer columns, not parsed out of a date. */
function toQuarterLabel(rocYear: unknown, season: unknown): string | null {
  if (typeof rocYear !== "number" || typeof season !== "number") {
    return null;
  }
  const gregorianYear = rocYear + ROC_TO_GREGORIAN_OFFSET;
  return `${String(gregorianYear).slice(-2)}Q${season}`;
}

/**
 * Pairs each resolved column's raw value with the as-of column(s) selected alongside it — a plain date
 * (daily/technical/point-in-time metrics) or a "{yy}Q{season}" label built from the row's own year/season
 * columns (quarterly-report metrics — see AnalysisMetricTable.asOfFormat).
 */
function buildValuesFromRow(
  row: Record<string, unknown>,
  fields: Array<{ field: string; asOfFormat: "date" | "quarter" }>,
): Record<string, { value: unknown; asOfDate: string | null }> {
  const values: Record<string, { value: unknown; asOfDate: string | null }> = {};
  for (const { field, asOfFormat } of fields) {
    const asOfDate =
      asOfFormat === "quarter"
        ? toQuarterLabel(row[asOfYearAlias(field)], row[asOfSeasonAlias(field)])
        : toDateString(row[asOfDateAlias(field)]);
    values[field] = { value: row[field], asOfDate };
  }
  return values;
}

interface MetricCtes {
  ctes: string[];
  joinClauses: string[];
  anchor: string;
}

/** The as-of column(s) for one resolved field, aliased under that field's own name(s) — see asOfFormat. */
function asOfSelectFor(c: Pick<ResolvedRef, "metricKey" | "field" | "asOfFormat">): string[] {
  const alias = cteAlias(c.metricKey);
  return c.asOfFormat === "quarter"
    ? [
        `${alias}."${AS_OF_YEAR_COLUMN}" AS "${asOfYearAlias(c.field)}"`,
        `${alias}."${AS_OF_SEASON_COLUMN}" AS "${asOfSeasonAlias(c.field)}"`,
      ]
    : [`${alias}."${AS_OF_DATE_COLUMN}" AS "${asOfDateAlias(c.field)}"`];
}

/**
 * Builds one CTE per involved metric (each picking a symbol's single latest row — see
 * analysisMetricTables.ts) plus the JOIN clauses linking them to the anchor. Shared by runScreener
 * (anchor = the first required/filtered metric) and runRanking (anchor = the metric being ranked).
 * `requiredMetricKeys[0]` is always the anchor table everything else joins against; anything in
 * `requiredMetricKeys` after that is INNER JOINed (a stock missing that data is dropped), anything in
 * `metricColumns` but not `requiredMetricKeys` is LEFT JOINed (shown as null, doesn't drop the stock).
 */
function buildMetricCtes(metricColumns: Map<string, Set<string>>, requiredMetricKeys: string[]): MetricCtes {
  const anchor = requiredMetricKeys[0];
  if (!anchor) {
    throw new AppError("At least one metric is required to anchor the query", 500);
  }
  const requiredSet = new Set(requiredMetricKeys);

  const ctes = [...metricColumns.entries()].map(([metricKey, columns]) => {
    const table = ANALYSIS_METRIC_TABLES[metricKey];
    if (!table) {
      throw new AppError(`Metric "${metricKey}" isn't wired up to the analysis database yet`, 501);
    }
    const cols = [...columns].map((column) => `"${column}"`).join(", ");
    // A row with a null latestOrderColumn (e.g. a failed/incomplete compute upstream) must never win
    // "latest" over a real dated row — Postgres sorts NULLs as highest by default, so DESC would put
    // it first. Excluding null-dated rows outright is what actually prevents that, not just relying
    // on ORDER BY ... NULLS LAST (that only fixes ties, not "null looks newest than every real date").
    const conditions = [`"${table.latestOrderColumn}" IS NOT NULL`, ...(table.latestFilter ? [table.latestFilter] : [])];
    // Selects extra column(s) so callers can report which period/trading day each returned value
    // describes — a raw passthrough of columns this query already has access to, not a new computation
    // (see AnalysisMetricTable.asOfFormat). Quarterly tables have their own year/season integer columns
    // (part of the primary key) — select those directly rather than parsing report_date back apart.
    const asOfSelect =
      table.asOfFormat === "quarter"
        ? `"year" AS "${AS_OF_YEAR_COLUMN}", "season" AS "${AS_OF_SEASON_COLUMN}"`
        : `"${table.latestOrderColumn}" AS "${AS_OF_DATE_COLUMN}"`;
    return `${cteAlias(metricKey)} AS (
      SELECT DISTINCT ON (symbol) symbol, ${asOfSelect}, ${cols}
      FROM ${table.table}
      WHERE ${conditions.join(" AND ")}
      ORDER BY symbol, "${table.latestOrderColumn}" DESC
    )`;
  });

  const joinClauses = [
    ...requiredMetricKeys
      .slice(1)
      .map((key) => `INNER JOIN ${cteAlias(key)} ON ${cteAlias(key)}.symbol = ${cteAlias(anchor)}.symbol`),
    ...[...metricColumns.keys()]
      .filter((key) => !requiredSet.has(key))
      .map((key) => `LEFT JOIN ${cteAlias(key)} ON ${cteAlias(key)}.symbol = ${cteAlias(anchor)}.symbol`),
  ];

  return { ctes, joinClauses, anchor };
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
 * Screens companies by filterCatalog metrics stored in the "analysis" Neon DB. Each involved metric
 * gets its own CTE picking each symbol's single latest row (see analysisMetricTables.ts); metrics with
 * an active filter are INNER JOINed (a stock without data there can't pass the filter), display-only
 * metrics are LEFT JOINed (shown as null rather than dropping the stock). Requires at least one filter
 * so there's always an anchor table — an empty-filters "list everything" mode isn't supported yet.
 *
 * Filtering is scoped to the analysis DB (filterCatalog fields only); `columns` may additionally include
 * "stock.price" (see columnField.ts), which is fetched separately from twse/tpex and merged into results.
 *
 * Paginated via a single query: `COUNT(*) OVER()` reports the total match count alongside each returned
 * row (Postgres evaluates window functions over the full WHERE-filtered set before LIMIT/OFFSET truncate
 * it, so the count is unaffected by pagination) — avoids a second round-trip just to get a total.
 */
export async function runScreener(
  filters: ScreenerFilter[],
  columns: ScreenerColumnRef[],
  pagination: Pagination,
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
  const resolvedFilters: ResolvedFilter[] = allRefs.slice(0, filters.length).map((ref, i) => ({
    ...ref,
    min: filters[i]!.min,
    max: filters[i]!.max,
    exclude: filters[i]!.exclude,
  }));
  const resolvedColumns = allRefs.slice(filters.length);

  const metricColumns = new Map<string, Set<string>>();
  const filterMetricKeys = new Set<string>();

  for (const f of resolvedFilters) {
    filterMetricKeys.add(f.metricKey);
    if (!metricColumns.has(f.metricKey)) metricColumns.set(f.metricKey, new Set());
    metricColumns.get(f.metricKey)?.add(f.column);
  }
  for (const c of resolvedColumns) {
    if (!metricColumns.has(c.metricKey)) metricColumns.set(c.metricKey, new Set());
    metricColumns.get(c.metricKey)?.add(c.column);
  }

  const { ctes, joinClauses, anchor } = buildMetricCtes(metricColumns, [...filterMetricKeys]);

  const params: Array<number | null> = [];
  // Every $n is cast to ::numeric explicitly — left untyped, Postgres can fail to resolve the
  // parameter's type ("could not determine data type of parameter") when it only ever appears
  // inside an `IS NULL OR ...` branch alongside a numeric column comparison.
  const whereConditions = resolvedFilters.map((filter) => {
    const colRef = `${cteAlias(filter.metricKey)}."${filter.column}"`;
    params.push(filter.min);
    const minParam = `$${params.length}::numeric`;
    params.push(filter.max);
    const maxParam = `$${params.length}::numeric`;

    return filter.exclude
      ? `(${colRef} IS NOT NULL AND ((${minParam} IS NOT NULL AND ${colRef} < ${minParam}) OR (${maxParam} IS NOT NULL AND ${colRef} > ${maxParam})))`
      : `(${colRef} IS NOT NULL AND (${minParam} IS NULL OR ${colRef} >= ${minParam}) AND (${maxParam} IS NULL OR ${colRef} <= ${maxParam}))`;
  });

  const selectColumns = resolvedColumns
    .flatMap((c) => [`${cteAlias(c.metricKey)}."${c.column}" AS "${c.field}"`, ...asOfSelectFor(c)])
    .join(", ");

  params.push(pagination.pageSize);
  const limitParam = `$${params.length}::int`;
  params.push((pagination.page - 1) * pagination.pageSize);
  const offsetParam = `$${params.length}::int`;

  const sql = `
    WITH ${ctes.join(",\n")}
    SELECT ${cteAlias(anchor)}.symbol AS symbol${selectColumns ? `, ${selectColumns}` : ""}, COUNT(*) OVER() AS "__totalCount"
    FROM ${cteAlias(anchor)}
    ${joinClauses.join("\n")}
    WHERE ${whereConditions.join(" AND ")}
    ORDER BY symbol
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const result = await queryNeon<Record<string, unknown>>(ANALYSIS_DB, sql, params);

  const totalCount = result.rows.length > 0 ? Number(result.rows[0]!.__totalCount) : 0;
  const wantsStockPrice = specialColumns.some((c) => c.field === STOCK_PRICE_FIELD);

  const resultColumns: ScreenerResultColumn[] = resolvedColumns.map((c) => ({
    field: c.field,
    metricName: c.metricName,
    fieldName: c.fieldName,
  }));
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  const results = result.rows.map((row) => ({
    symbol: row.symbol as string,
    name: null,
    values: buildValuesFromRow(row, resolvedColumns),
  }));
  await mergeStockPrices(results, wantsStockPrice);
  await mergeCompanyNames(results);

  return {
    count: totalCount,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: Math.ceil(totalCount / pagination.pageSize),
    columns: resultColumns,
    results,
  };
}

export interface RankingResult {
  field: string;
  direction: "asc" | "desc";
  columns: ScreenerResultColumn[];
  results: ScreenerResultRow[];
}

/**
 * Top-N ranking by a single metric (e.g. "highest dividend yield", "lowest P/E") — for homepage cards,
 * not the full screener. Reuses the same CTE/JOIN machinery as runScreener, but the ranked field itself
 * is the anchor (and is required to be non-null, via the same "latest row" CTE plus an explicit
 * IS NOT NULL condition) instead of coming from a threshold filter — a ranking has no threshold, just an
 * ORDER BY and a LIMIT. `columns` may add extra display fields (including "stock.price") the same way
 * runScreener's do; the ranked field itself is always included whether or not it's also requested.
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

  const metricColumns = new Map<string, Set<string>>();
  metricColumns.set(rankedRef.metricKey, new Set([rankedRef.column]));
  for (const c of extraColumnRefs) {
    if (!metricColumns.has(c.metricKey)) metricColumns.set(c.metricKey, new Set());
    metricColumns.get(c.metricKey)?.add(c.column);
  }

  const { ctes, joinClauses, anchor } = buildMetricCtes(metricColumns, [rankedRef.metricKey]);

  const rankedColRef = `${cteAlias(rankedRef.metricKey)}."${rankedRef.column}"`;
  const allColumnRefs = [rankedRef, ...extraColumnRefs];
  const selectColumns = allColumnRefs
    .flatMap((c) => [`${cteAlias(c.metricKey)}."${c.column}" AS "${c.field}"`, ...asOfSelectFor(c)])
    .join(", ");

  const sql = `
    WITH ${ctes.join(",\n")}
    SELECT ${cteAlias(anchor)}.symbol AS symbol, ${selectColumns}
    FROM ${cteAlias(anchor)}
    ${joinClauses.join("\n")}
    WHERE ${rankedColRef} IS NOT NULL
    ORDER BY ${rankedColRef} ${direction === "asc" ? "ASC" : "DESC"}
    LIMIT $1::int
  `;

  const result = await queryNeon<Record<string, unknown>>(ANALYSIS_DB, sql, [limit]);

  const wantsStockPrice = specialColumns.some((c) => c.field === STOCK_PRICE_FIELD);
  const resultColumns: ScreenerResultColumn[] = allColumnRefs.map((c) => ({
    field: c.field,
    metricName: c.metricName,
    fieldName: c.fieldName,
  }));
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  const results = result.rows.map((row) => ({
    symbol: row.symbol as string,
    name: null,
    values: buildValuesFromRow(row, allColumnRefs),
  }));
  await mergeStockPrices(results, wantsStockPrice);
  await mergeCompanyNames(results);

  return { field, direction, columns: resultColumns, results };
}

/**
 * The oingg-analysis-ts-backed ranking path for per.peRatio/pbr.pbRatio/dividendYield.dividendYieldPct —
 * see VALUATION_RANKING_FIELDS. Only "stock.price" can be combined with it as an extra column: any other
 * field would need an analysis-DB join this path deliberately doesn't do (that's what the general
 * analysis-DB ranking path above, or the full /screener endpoint, is for).
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
        `oingg-analysis-ts's ranking endpoint, not this service's analysis-DB join) — only "stock.price" ` +
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
  await mergeStockPrices(results, wantsStockPrice);
  await mergeCompanyNames(results);

  const resultColumns: ScreenerResultColumn[] = [
    { field, metricName: rankedRef!.metricName, fieldName: rankedRef!.fieldName },
  ];
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  return { field, direction, columns: resultColumns, results };
}
