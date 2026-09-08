import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { FilterCategory } from "@/domainBusiness/filterCatalog/filterCatalog.types.js";

interface RawPitMetric {
  metricCode: string;
  validTokens: string[];
}

interface RawPitCategory {
  categoryKey: string;
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
        Array.isArray((c as RawPitCategory).metrics) &&
        (c as RawPitCategory).metrics.every(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            typeof (m as RawPitMetric).metricCode === "string" &&
            Array.isArray((m as RawPitMetric).validTokens) &&
            (m as RawPitMetric).validTokens.every((t) => typeof t === "string"),
        ),
    )
  );
}

/**
 * Converts analysis-ts's pitMetrics-native `/filters` shape into this codebase's existing
 * FilterCategory/FilterMetric/FilterField shape, so the rest of this domain (repository, screener field
 * validation) doesn't need to change.
 *
 * Deliberately built from each metric's `validTokens` array, NOT its `allowedPeriodTypes`/
 * `allowedLookbackRanges`/`allowedSamplingIntervals`/`allowedSnapshotCadences` arrays (added 2026-09-08
 * when analysis-ts split their internal `metric_values.basis` column into these four precise fields —
 * "basis" was overloading an accounting reserved word). Those four arrays do NOT form a free cross
 * product for every metric — e.g. `beta`'s 3 lookbackRanges × 3 samplingIntervals looks like 9 possible
 * tokens, but only 3 pairings (1Y_1D, 2Y_1W, 5Y_1M) actually have data; the other 6 silently returned
 * empty results before analysis-ts added `validTokens` as the one authoritative list, at our request
 * after we caught this live rather than building a Cartesian-product menu with 6 dead options in it.
 *
 * The new shape still carries no display copy at all (no category/metric/field name, description, source,
 * or unit — analysis-ts hasn't written it yet) and no per-field granularity below "metric" — a field is
 * addressed as `<metricCode>.<token>` (e.g. "roe.TTM", "beta.2Y_1W"), one "field" per valid token, not a
 * separately-named sub-entity like the old fields array. `name`/`period` are placeholder-filled with the
 * key/token itself (this type requires a name) until analysis-ts adds real copy; description/source/unit
 * stay null, which this type already treats as "not yet provided" everywhere else it's used.
 */
function toFilterCategories(raw: RawPitCategory[]): FilterCategory[] {
  return raw.map((category, categoryIndex) => ({
    key: category.categoryKey,
    name: category.categoryKey,
    sort: categoryIndex,
    metrics: category.metrics.map((metric, metricIndex) => ({
      key: metric.metricCode,
      name: metric.metricCode,
      path: metric.metricCode,
      description: null,
      source: null,
      unit: null,
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

/** Fetches the filter category/metric/field catalog from oingg-analysis-ts's `/filters` endpoint. */
export async function fetchFilterCatalog(): Promise<FilterCategory[]> {
  const url = buildAnalysisServiceUrl("/filters");
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
