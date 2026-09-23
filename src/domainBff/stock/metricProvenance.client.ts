import { AppError } from "@/http/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  MetricProvenanceEntry,
  MetricProvenanceMetricCode,
  MetricProvenanceResult,
} from "@/domainBff/stock/metricProvenance.types.js";

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toEntryValue(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function normalizeEntries(raw: unknown): MetricProvenanceEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => {
    const entry = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    return {
      role: typeof entry.role === "string" ? entry.role : "",
      fiscalYear: toNumberOrNull(entry.fiscalYear),
      fiscalQuarter: toNumberOrNull(entry.fiscalQuarter),
      type: entry.type === "statementField" ? "statementField" : "other",
      statementType:
        entry.statementType === "balanceSheet" || entry.statementType === "incomeStatement" || entry.statementType === "cashFlowStatement"
          ? entry.statementType
          : null,
      fieldKey: toStringOrNull(entry.fieldKey),
      sourceDescription: toStringOrNull(entry.sourceDescription),
      value: toEntryValue(entry.value),
    };
  });
}

function isMetricProvenanceResponse(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null;
}

/**
 * Fetches the raw-filing provenance trail behind one metric's computed value from analysis-ts's GET
 * /companies/{symbol}/metric-provenance — backs web-nuxt's "trace this badge's number back to the raw
 * filing" feature. Pilot scope started at 3 metricCodes (sue/chowderNumber/roe) and has since grown to
 * 112+ (see GET /metrics' hasProvenance field) — analysis-ts validates metricCode itself now (see
 * metricProvenance.types.ts's MetricProvenanceMetricCode; bff-ts stopped hardcoding the allowed set
 * 2026-09-15). Pure pass-through, zero computation (see [[feedback_proxy_apis_no_transformation]]). Unlike
 * bff-ts's other analysis-ts calls, symbol is a PATH segment on analysis-ts's own endpoint too (not a
 * query param) — confirmed live, 2026-09-10 — so it's interpolated into the path here instead of added
 * to searchParams.
 *
 * `entries[].value` is passed through with NO type coercion: most entries are bigint-serialized strings
 * (raw statement figures, e.g. "706561938"), but at least one confirmed-live case (chowderNumber's cash
 * dividend yield "market snapshot" entry) is a plain float (0.92) instead — consumers must not assume
 * either type. The top-level `value` (the metric's own computed value, e.g. roe's 34.78) is always a
 * number. Omitting year/season gets the latest quarter on file, same convention as
 * fetchFinancialStatement/fetchPiotroskiBreakdown. Always 200 — an unknown symbol or a quarter with no
 * data comes back with `found: false`, `entries: []`, and every other field null, never a 404.
 */
export async function fetchMetricProvenance(
  symbol: string,
  metricCode: MetricProvenanceMetricCode,
  year?: string,
  season?: string,
): Promise<MetricProvenanceResult> {
  const searchParams: Record<string, string> = { metricCode };
  if (year !== undefined) {
    searchParams.year = year;
  }
  if (season !== undefined) {
    searchParams.season = season;
  }

  const url = buildAnalysisServiceUrl(`/companies/${encodeURIComponent(symbol)}/metric-provenance`, searchParams);
  const response = await fetchAnalysisService(url);

  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    // analysis-ts's 400 here is a nested zod error tree (e.g. { message: "Invalid query parameters.",
    // errors: { metricCode: { _errors: ["metricCode is required, ..."] } } }), not the flat { message }
    // shape most of this codebase's other analysis-ts clients relay — the useful detail (e.g. the full
    // list of currently-supported metricCodes) lives in errors.metricCode._errors[0], not the top-level
    // message, so dig for it rather than surfacing the generic "Invalid query parameters." wrapper.
    const fieldError = (
      body as { errors?: { metricCode?: { _errors?: unknown[] } } } | null
    )?.errors?.metricCode?._errors?.[0];
    const topLevelMessage = (body as { message?: unknown } | null)?.message;
    const message = typeof fieldError === "string" ? fieldError : topLevelMessage;
    if (typeof message !== "string") {
      logger.error({ url: url.toString() }, "Invalid metric provenance request, no message in response body");
    }
    throw new AppError(typeof message === "string" ? message : "Invalid metric provenance request", 400);
  }
  assertAnalysisServiceOk(response, url, "Metric provenance endpoint");

  const body: unknown = await response.json();
  if (!isMetricProvenanceResponse(body)) {
    logger.error({ url: url.toString() }, "Metric provenance endpoint response is not an object");
    throw new AppError("Metric provenance endpoint response is not an object", 502);
  }

  return {
    symbol: typeof body.symbol === "string" ? body.symbol : symbol,
    metricCode,
    found: body.found === true,
    fiscalYear: toNumberOrNull(body.fiscalYear),
    fiscalQuarter: toNumberOrNull(body.fiscalQuarter),
    value: toNumberOrNull(body.value),
    entries: normalizeEntries(body.entries),
    methodologyNote: toStringOrNull(body.methodologyNote),
  };
}
