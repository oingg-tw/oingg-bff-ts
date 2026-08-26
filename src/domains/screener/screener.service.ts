import { queryNeon } from "../../adapters/neon/index.js";
import { findFilterField } from "../filterCatalog/index.js";
import { AppError } from "../../shared/errorHandler.js";
import { parseFieldRef } from "../../shared/fieldRef.js";
import { ANALYSIS_METRIC_TABLES } from "./analysisMetricTables.js";
import type { ScreenerColumnRef, ScreenerFilter, ScreenerResult } from "./screener.types.js";

const ANALYSIS_DB = "analysis";
const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function toSnakeCase(camelCase: string): string {
  return camelCase.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
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

async function resolveFieldRef(field: string): Promise<ResolvedRef> {
  const { metricKey, fieldKey } = parseFieldRef(field);
  const lookup = await findFilterField(metricKey, fieldKey);
  if (!lookup) {
    throw new AppError(`Unknown filter field "${field}"`, 400);
  }
  if (!ANALYSIS_METRIC_TABLES[metricKey]) {
    throw new AppError(`Metric "${metricKey}" isn't wired up to the analysis database yet`, 501);
  }
  return {
    metricKey,
    fieldKey,
    field,
    column: toSafeColumn(fieldKey),
    metricName: lookup.metricName,
    fieldName: lookup.fieldName,
  };
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
 */
export async function runScreener(
  filters: ScreenerFilter[],
  columns: ScreenerColumnRef[],
): Promise<ScreenerResult> {
  if (filters.length === 0) {
    throw new AppError("At least one filter is required", 400);
  }

  const resolvedFilters: ResolvedFilter[] = await Promise.all(
    filters.map(async (filter) => ({
      ...(await resolveFieldRef(filter.field)),
      min: filter.min,
      max: filter.max,
      exclude: filter.exclude,
    })),
  );
  const resolvedColumns = await Promise.all(columns.map((c) => resolveFieldRef(c.field)));

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
    const whereClause = table.latestFilter ? `WHERE ${table.latestFilter}` : "";
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

  const sql = `
    WITH ${ctes.join(",\n")}
    SELECT ${cteAlias(anchor)}.symbol AS symbol${selectColumns ? `, ${selectColumns}` : ""}
    FROM ${cteAlias(anchor)}
    ${joinClauses.join("\n")}
    WHERE ${whereConditions.join(" AND ")}
    ORDER BY symbol
  `;

  const result = await queryNeon<Record<string, unknown>>(ANALYSIS_DB, sql, params);

  return {
    count: result.rows.length,
    columns: resolvedColumns.map((c) => ({ field: c.field, metricName: c.metricName, fieldName: c.fieldName })),
    results: result.rows.map((row) => {
      const { symbol, ...values } = row;
      return { symbol: symbol as string, values };
    }),
  };
}
