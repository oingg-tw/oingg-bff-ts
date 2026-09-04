import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  EtfColumnRef,
  EtfFilterCatalog,
  EtfFilterField,
  EtfScreenerFilter,
  EtfScreenerResult,
  EtfScreenerResultRow,
  EtfScreenerValue,
} from "@/domains/etfScreener/etfScreener.types.js";

export interface EtfScreenerSort {
  field: string;
  order: "asc" | "desc";
}

function normalizeEtfFilterField(raw: unknown): EtfFilterField {
  const r = raw as Record<string, unknown>;
  const field: EtfFilterField = {
    field: String(r.field),
    label: String(r.label),
    kind: r.kind === "categorical" ? "categorical" : "numeric",
  };
  if (Array.isArray(r.values)) {
    field.values = r.values.map(String);
  }
  return field;
}

function normalizeEtfScreenerValue(value: unknown): EtfScreenerValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  return String(value);
}

function normalizeEtfScreenerRow(raw: unknown): EtfScreenerResultRow {
  const r = raw as Record<string, unknown>;
  const rawValues = (r.values ?? {}) as Record<string, unknown>;
  const values: Record<string, EtfScreenerValue> = {};
  for (const [key, value] of Object.entries(rawValues)) {
    values[key] = normalizeEtfScreenerValue(value);
  }
  return {
    symbol: String(r.symbol),
    fundName: String(r.fundName ?? ""),
    shortName: String(r.shortName ?? ""),
    issuerName: typeof r.companyName === "string" ? r.companyName : null,
    category: String(r.category ?? ""),
    values,
  };
}

/**
 * analysis-ts's ETF screener error envelope is the same `{ message }` 400 shape as the stock screener's
 * (see analysisScreenerClient.ts's handleJsonResponse) — relayed as-is since it's already a caller-facing,
 * actionable message (unknown field, wrong filter shape for that field's kind).
 */
async function handleJsonResponse(response: Response, url: URL): Promise<unknown> {
  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== "string") {
      logger.error({ url: url.toString() }, "Invalid ETF screener request, no message in response body");
    }
    throw new AppError(typeof message === "string" ? message : "Invalid ETF screener request", 400);
  }
  assertAnalysisServiceOk(response, url, "ETF screener endpoint");
  return response.json();
}

async function getJson(path: string): Promise<unknown> {
  const url = buildAnalysisServiceUrl(path);
  const response = await fetchAnalysisService(url);
  return handleJsonResponse(response, url);
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const url = buildAnalysisServiceUrl(path);
  const response = await fetchAnalysisService(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleJsonResponse(response, url);
}

/**
 * ETF filter/column catalog from analysis-ts's GET /etf-screener/filters. Not cached locally (unlike the
 * stock screener's filter catalog, synced to bff-ts's own DB at startup): categorical fields' `values`
 * are live DB-distinct values that can grow over time, and there's no separate metricName/fieldName
 * decoration step needed here since `label` already covers that per field. This is the first version of
 * a feature analysis-ts expects to keep expanding.
 */
export async function fetchEtfFilterCatalog(): Promise<EtfFilterCatalog> {
  const body = (await getJson("/etf-screener/filters")) as { fields?: unknown };
  if (!Array.isArray(body.fields)) {
    throw new AppError("ETF filter catalog response is missing a fields array", 502);
  }
  return { fields: body.fields.map(normalizeEtfFilterField) };
}

/**
 * Runs the ETF screener against analysis-ts's POST /etf-screener. Unlike the stock screener, field
 * validation/error messages come entirely from analysis-ts (no local catalog cache here to resolve
 * against) — `filters` come in two shapes: numeric (`min`/`max`/`exclude`) or categorical (`values`
 * array, IN semantics, e.g. `{"field":"market","values":["TWSE"]}`).
 */
export async function fetchEtfScreenerResults(
  filters: EtfScreenerFilter[],
  columns: EtfColumnRef[],
  page: number,
  pageSize: number,
  sort?: EtfScreenerSort,
): Promise<EtfScreenerResult> {
  const body = (await postJson("/etf-screener", {
    filters,
    columns,
    page,
    pageSize,
    ...(sort ? { sortField: sort.field, sortOrder: sort.order } : {}),
  })) as { count?: unknown; page?: unknown; pageSize?: unknown; totalPages?: unknown; results?: unknown };

  if (
    typeof body.count !== "number" ||
    typeof body.page !== "number" ||
    typeof body.pageSize !== "number" ||
    typeof body.totalPages !== "number" ||
    !Array.isArray(body.results)
  ) {
    throw new AppError("ETF screener response is missing count/page/pageSize/totalPages/results", 502);
  }

  return {
    count: body.count,
    page: body.page,
    pageSize: body.pageSize,
    totalPages: body.totalPages,
    results: body.results.map(normalizeEtfScreenerRow),
  };
}
