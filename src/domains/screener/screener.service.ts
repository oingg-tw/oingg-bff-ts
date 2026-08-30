import { queryNeon } from "../../adapters/neon/index.js";
import { findFilterFields } from "../filterCatalog/index.js";
import { getLatestClosePrices } from "../stock/index.js";
import { AppError } from "../../shared/errorHandler.js";
import { parseFieldRef, toFieldRefString } from "../../shared/fieldRef.js";
import { ANALYSIS_METRIC_TABLES } from "./analysisMetricTables.js";
import { SPECIAL_COLUMNS } from "./columnField.js";
import type { Pagination } from "./pagination.js";
import type { ScreenerColumnRef, ScreenerFilter, ScreenerResult, ScreenerResultColumn } from "./screener.types.js";

const ANALYSIS_DB = "analysis";
const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const STOCK_PRICE_FIELD = "stock.price";

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
    if (!ANALYSIS_METRIC_TABLES[ref.metricKey]) {
      throw new AppError(`Metric "${ref.metricKey}" isn't wired up to the analysis database yet`, 501);
    }
    return {
      metricKey: ref.metricKey,
      fieldKey: ref.fieldKey,
      field: ref.field,
      column: toSafeColumn(ref.fieldKey),
      metricName: lookup.metricName,
      fieldName: lookup.fieldName,
    };
  });
}

interface ResolvedFilter extends ResolvedRef {
  min: number | null;
  max: number | null;
  exclude: boolean;
}

const cteAlias = (metricKey: string) => `m_${metricKey}`;

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

  const metricKeys = [...metricColumns.keys()];
  const requiredMetricKeys = [...filterMetricKeys];
  const displayOnlyMetricKeys = metricKeys.filter((key) => !filterMetricKeys.has(key));
  const anchor = requiredMetricKeys[0];
  if (!anchor) {
    throw new AppError("At least one filter is required", 400);
  }

  const ctes = metricKeys.map((metricKey) => {
    const table = ANALYSIS_METRIC_TABLES[metricKey];
    if (!table) {
      throw new AppError(`Metric "${metricKey}" isn't wired up to the analysis database yet`, 501);
    }
    const cols = [...(metricColumns.get(metricKey) ?? [])].map((column) => `"${column}"`).join(", ");
    // A row with a null latestOrderColumn (e.g. a failed/incomplete compute upstream) must never win
    // "latest" over a real dated row — Postgres sorts NULLs as highest by default, so DESC would put
    // it first. Excluding null-dated rows outright is what actually prevents that, not just relying
    // on ORDER BY ... NULLS LAST (that only fixes ties, not "null looks newest than every real date").
    const conditions = [`"${table.latestOrderColumn}" IS NOT NULL`, ...(table.latestFilter ? [table.latestFilter] : [])];
    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    return `${cteAlias(metricKey)} AS (
      SELECT DISTINCT ON (symbol) symbol, ${cols}
      FROM ${table.table}
      ${whereClause}
      ORDER BY symbol, "${table.latestOrderColumn}" DESC
    )`;
  });

  const joinClauses = [
    ...requiredMetricKeys
      .slice(1)
      .map((key) => `INNER JOIN ${cteAlias(key)} ON ${cteAlias(key)}.symbol = ${cteAlias(anchor)}.symbol`),
    ...displayOnlyMetricKeys.map(
      (key) => `LEFT JOIN ${cteAlias(key)} ON ${cteAlias(key)}.symbol = ${cteAlias(anchor)}.symbol`,
    ),
  ];

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
    .map((c) => `${cteAlias(c.metricKey)}."${c.column}" AS "${c.field}"`)
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
  const pricesBySymbol = wantsStockPrice
    ? await getLatestClosePrices(result.rows.map((row) => row.symbol as string))
    : null;

  const resultColumns: ScreenerResultColumn[] = resolvedColumns.map((c) => ({
    field: c.field,
    metricName: c.metricName,
    fieldName: c.fieldName,
  }));
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  return {
    count: totalCount,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: Math.ceil(totalCount / pagination.pageSize),
    columns: resultColumns,
    results: result.rows.map((row) => {
      const { symbol, __totalCount, ...values } = row;
      if (pricesBySymbol) {
        values[STOCK_PRICE_FIELD] = pricesBySymbol.get(symbol as string) ?? null;
      }
      return { symbol: symbol as string, values };
    }),
  };
}
