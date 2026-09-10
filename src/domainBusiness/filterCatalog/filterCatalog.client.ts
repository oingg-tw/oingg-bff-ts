import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { FilterCategory } from "@/domainBusiness/filterCatalog/filterCatalog.types.js";

interface RawPitMetric {
  metricCode: string;
  displayName: string;
  unit: string;
  validTokens: string[];
  /** Absent entirely (not an empty string) for metrics without a documented formula yet — pilot rollout, 2026-09-10. */
  formulaLatex?: string;
}

interface RawPitCategory {
  categoryKey: string;
  categoryDisplayName: string;
  metrics: RawPitMetric[];
}

function isRawPitCategoryArray(value: unknown): value is RawPitCategory[] {
  return (
    Array.isArray(value) &&
    value.every(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as RawPitCategory).categoryKey === "string" &&
        typeof (c as RawPitCategory).categoryDisplayName === "string" &&
        Array.isArray((c as RawPitCategory).metrics) &&
        (c as RawPitCategory).metrics.every(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            typeof (m as RawPitMetric).metricCode === "string" &&
            typeof (m as RawPitMetric).displayName === "string" &&
            typeof (m as RawPitMetric).unit === "string" &&
            Array.isArray((m as RawPitMetric).validTokens) &&
            (m as RawPitMetric).validTokens.every((t) => typeof t === "string") &&
            ((m as RawPitMetric).formulaLatex === undefined || typeof (m as RawPitMetric).formulaLatex === "string"),
        ),
    )
  );
}

/**
 * Converts analysis-ts's pitMetrics-native `/filters` shape into this codebase's existing
 * FilterCategory/FilterMetric/FilterField shape, so the rest of this domain (repository, screener field
 * validation) doesn't need to change.
 *
 * Deliberately built from each metric's `validTokens` array, NOT any `allowedPeriodTypes`/
 * `allowedLookbackRanges`/`allowedSamplingIntervals`/`allowedSnapshotCadences`-style arrays (analysis-ts
 * briefly sent these alongside validTokens 2026-09-08, then removed them 2026-09-09 once they confirmed
 * this codebase never read them — see [[project_basis_field_split_migration]]). Those arrays never formed
 * a free cross product for every metric — e.g. `beta`'s 3 lookbackRanges × 3 samplingIntervals looked like
 * 9 possible tokens, but only 3 pairings (1Y_1D, 2Y_1W, 5Y_1M) actually have data — so `validTokens` has
 * been the only field this client has ever parsed for a field's possible values.
 *
 * `displayName`/`unit` (real Chinese labels, e.g. "殖利率（交易所公告）"/"%") landed on every one of the 64
 * metrics as of 2026-09-09 — used directly for the metric-level name/unit now instead of the metricCode
 * placeholder this client used from 2026-09-08 until copy shipped. `categoryDisplayName` (e.g. "股利" for
 * categoryKey "dividend") landed on all 7 categories the same day, added here shortly after — used for the
 * category-level name. Individual tokens still have no display name of their own (no per-token label
 * distinct from the token string) — `key`/`name` for those stay placeholder-filled with the raw token.
 *
 * `formulaLatex` (LaTeX source, meant for read-only rendering — analysis-ts's own note: NOT for actual
 * recomputation, their real figures are bigint-precise and a LaTeX compute engine would be float-based)
 * started rolling out 2026-09-10, pilot on 4 metrics (roe/peRatio/sue/chowderNumber) — absent entirely
 * (not an empty string) on every other metric until analysis-ts documents more. Passed through as `null`
 * when absent, same "not yet provided" convention as description/source elsewhere in this type.
 */
function toFilterCategories(raw: RawPitCategory[]): FilterCategory[] {
  return raw.map((category, categoryIndex) => ({
    key: category.categoryKey,
    name: category.categoryDisplayName,
    sort: categoryIndex,
    metrics: category.metrics.map((metric, metricIndex) => ({
      key: metric.metricCode,
      name: metric.displayName,
      path: metric.metricCode,
      description: null,
      source: null,
      unit: metric.unit,
      formulaLatex: metric.formulaLatex ?? null,
      sort: metricIndex,
      fields: metric.validTokens.map((token, tokenIndex) => ({
        key: token,
        name: token,
        period: token,
        description: null,
        source: null,
        unit: null,
        sort: tokenIndex,
      })),
    })),
  }));
}

/**
 * Fetches the filter category/metric/field catalog from oingg-analysis-ts's `/metrics` endpoint —
 * renamed from `/filters` 2026-09-10 (their reasoning: the response is metric definitions, not filters
 * themselves; response shape unchanged). bff-ts's own public `GET /filters` path is deliberately left
 * unchanged — this is purely an internal upstream rename, shielded from web-nuxt same as the
 * basis->token/periodType rename earlier (see [[project_basis_field_split_migration]]).
 */
export async function fetchFilterCatalog(): Promise<FilterCategory[]> {
  const url = buildAnalysisServiceUrl("/metrics");
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Filters service");

  const body: unknown = await response.json();
  const categories = (body as { categories?: unknown } | null)?.categories;
  if (!isRawPitCategoryArray(categories)) {
    logger.error({ url: url.toString() }, 'Filters service response is missing a valid "categories" array');
    throw new AppError('Filters service response is missing a valid "categories" array', 502);
  }

  return toFilterCategories(categories);
}
