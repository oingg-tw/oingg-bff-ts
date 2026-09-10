import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { FilterCategory, FilterMetricBadge, FilterMetricBadgeThreshold } from "@/domainBusiness/filterCatalog/filterCatalog.types.js";

const BADGE_COMPARATORS = ["gt", "lt", "gte", "abs_lt", "in_range"] as const;

function isRawBadgeThreshold(value: unknown): value is FilterMetricBadgeThreshold {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const t = value as FilterMetricBadgeThreshold;
  return (
    typeof t.description === "string" &&
    typeof t.denominator === "number" &&
    (t.comparator === undefined || (BADGE_COMPARATORS as readonly string[]).includes(t.comparator)) &&
    (t.value === undefined || typeof t.value === "number") &&
    (t.valueMin === undefined || typeof t.valueMin === "number") &&
    (t.valueMax === undefined || typeof t.valueMax === "number") &&
    (t.compareAgainstFieldId === undefined || typeof t.compareAgainstFieldId === "string") &&
    (t.allPositiveFieldIds === undefined ||
      (Array.isArray(t.allPositiveFieldIds) && t.allPositiveFieldIds.every((f) => typeof f === "string")))
  );
}

function isRawBadge(value: unknown): value is FilterMetricBadge {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const b = value as FilterMetricBadge;
  return (
    typeof b.id === "string" &&
    typeof b.name === "string" &&
    typeof b.nameEn === "string" &&
    typeof b.author === "string" &&
    typeof b.summary === "string" &&
    typeof b.detail === "string" &&
    (b.token === undefined || typeof b.token === "string") &&
    isRawBadgeThreshold(b.threshold)
  );
}

interface RawPitMetric {
  metricCode: string;
  displayName: string;
  unit: string;
  validTokens: string[];
  /** Absent entirely (not an empty string) for metrics without a documented formula yet — pilot rollout, 2026-09-10. */
  formulaLatex?: string;
  /** Absent entirely (not an empty string) for metrics without a documented reference link yet, 2026-09-10. */
  referenceUrl?: string;
  /** Present only on the ~11 metrics with a curated "guru badge" methodology threshold, 2026-09-10. */
  badge?: FilterMetricBadge;
  /** Data-provenance category labels — a fixed 9-label vocabulary, required and non-empty on every metric (2026-09-10). */
  sources: string[];
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
            ((m as RawPitMetric).formulaLatex === undefined || typeof (m as RawPitMetric).formulaLatex === "string") &&
            ((m as RawPitMetric).referenceUrl === undefined || typeof (m as RawPitMetric).referenceUrl === "string") &&
            ((m as RawPitMetric).badge === undefined || isRawBadge((m as RawPitMetric).badge)) &&
            Array.isArray((m as RawPitMetric).sources) &&
            (m as RawPitMetric).sources.every((s) => typeof s === "string"),
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
 *
 * `referenceUrl` (external reference link, e.g. a Wikipedia article) also landed 2026-09-10, already
 * populated for several metrics (dividendPayoutRatio, dividendCoverageRatio, dividendYield, ...) — this
 * exists so web-nuxt can drop its own hardcoded per-metric source-link table (guru-badges.ts) and just
 * render whatever analysis-ts's MetricDefinitionSpec declares, avoiding maintaining the same links twice.
 * Same absent-not-empty-string and null-when-absent convention as formulaLatex.
 *
 * `badge` (2026-09-10, same rollout wave) carries a curated "guru badge" methodology threshold — web-nuxt's
 * own hardcoded GURU_BADGES payload (11 entries), sent to analysis-ts and now echoed back attached to the
 * metric it belongs to, so web-nuxt can read it off this catalog instead of maintaining its own copy.
 * Present on exactly the 11 metrics that payload covered (altmanZScore, beneishMScore, ohlsonOScore,
 * zmijewskiScore, grahamNumber, ncav, accrualsRatio, dividendPayoutRatio, sue, chowderNumber, eps) —
 * Piotroski F-Score was deliberately excluded by mutual agreement (its clamp/round + custom isMet logic
 * doesn't fit analysis-ts's threshold/comparator vocabulary) and stays frontend-hardcoded. Passed through
 * as-is (whole object), null when absent, same convention as formulaLatex/referenceUrl. `badge.token` is
 * itself optional within the object — absent when the threshold spans multiple periods instead of one
 * (confirmed live: eps's threshold checks both "eps.TTM" and "eps.Q" via allPositiveFieldIds, so there's
 * no single token to name).
 *
 * `sources` (data-provenance category labels, e.g. "公開發行公司資產負債表（XBRL）") is different in kind from
 * formulaLatex/referenceUrl/badge: analysis-ts guarantees it's always present and non-empty for every
 * metric (added 2026-09-10, a fixed 9-label vocabulary), not a "not every metric has one yet" field, so
 * it's validated as required here (missing/wrong-shape fails the whole sync, same as displayName/unit/
 * validTokens) rather than defaulted to null/undefined.
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
      referenceUrl: metric.referenceUrl ?? null,
      badge: metric.badge ?? null,
      sources: metric.sources,
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
 * themselves; response shape unchanged). Unlike the basis->token/periodType rename (a pure internal
 * wire-format change, shielded from web-nuxt — see [[project_basis_field_split_migration]]), this one
 * carries domain-language significance, so bff-ts's own public path was renamed too (`GET /filters` ->
 * `GET /metrics`, same day) — for ubiquitous language, so cross-team communication doesn't end up with
 * two names for the same thing.
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
