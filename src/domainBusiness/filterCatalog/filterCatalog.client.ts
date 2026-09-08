import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { FilterCategory } from "@/domainBusiness/filterCatalog/filterCatalog.types.js";

interface RawPitMetric {
  metricCode: string;
  allowedBases: string[];
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
            Array.isArray((m as RawPitMetric).allowedBases) &&
            (m as RawPitMetric).allowedBases.every((b) => typeof b === "string"),
        ),
    )
  );
}

/**
 * Converts analysis-ts's pitMetrics-native `/filters` shape (`{categories: [{categoryKey, metrics:
 * [{metricCode, allowedBases}]}]}`, replacing the old `filterCatalog.csv`-backed shape on 2026-09-08 —
 * see the incident this rebuild followed, [[project_screener_outage_pitmetrics_migration]]) into this
 * codebase's existing FilterCategory/FilterMetric/FilterField shape, so the rest of this domain (repository,
 * screener field validation) doesn't need to change.
 *
 * The new shape carries no display copy at all (no category/metric/field name, description, source, or
 * unit — analysis-ts hasn't written it yet) and no per-field granularity below "metric" — a field is
 * addressed as `<metricCode>.<basis>` (e.g. "roe.TTM"), one "field" per allowed basis string, not a
 * separately-named sub-entity like the old fields array. `name`/`period` are placeholder-filled with the
 * key/basis itself (this type requires a name) until analysis-ts adds real copy; description/source/unit
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
      fields: metric.allowedBases.map((basis, basisIndex) => ({
        key: basis,
        name: basis,
        period: basis,
        description: null,
        source: null,
        unit: null,
        sort: basisIndex,
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
