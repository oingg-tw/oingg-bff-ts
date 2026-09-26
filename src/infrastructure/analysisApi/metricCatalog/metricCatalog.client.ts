import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { MetricCatalogGatewayPort } from "@/application/ports/metricCatalogGateway.js";
import type {
  MetricBadge,
  MetricBadgePercentileRank,
  MetricBadgeThreshold,
  MetricCategory,
} from "@/application/metricCatalog/metricCatalog.types.js";

const BADGE_COMPARATORS = ["gt", "lt", "gte", "lte", "abs_lt", "in_range"] as const;
const PERCENTILE_RANK_SCOPES = ["market", "sector"] as const;
const PERCENTILE_RANK_DIRECTIONS = ["asc", "desc"] as const;

function isRawPercentileRank(value: unknown): value is MetricBadgePercentileRank {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const p = value as MetricBadgePercentileRank;
  return (
    (PERCENTILE_RANK_SCOPES as readonly string[]).includes(p.scope) &&
    (PERCENTILE_RANK_DIRECTIONS as readonly string[]).includes(p.direction) &&
    typeof p.topPercent === "number" &&
    (p.excludeZero === undefined || typeof p.excludeZero === "boolean")
  );
}

function isRawBadgeThreshold(value: unknown): value is MetricBadgeThreshold {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const t = value as MetricBadgeThreshold;
  return (
    typeof t.description === "string" &&
    (t.denominator === undefined || typeof t.denominator === "number") &&
    (t.comparator === undefined || (BADGE_COMPARATORS as readonly string[]).includes(t.comparator)) &&
    (t.value === undefined || typeof t.value === "number") &&
    (t.valueMin === undefined || typeof t.valueMin === "number") &&
    (t.valueMax === undefined || typeof t.valueMax === "number") &&
    (t.compareAgainstFieldId === undefined || typeof t.compareAgainstFieldId === "string") &&
    (t.allPositiveFieldIds === undefined ||
      (Array.isArray(t.allPositiveFieldIds) && t.allPositiveFieldIds.every((f) => typeof f === "string"))) &&
    (t.warning === undefined || isRawBadgeThreshold(t.warning)) &&
    (t.percentileRank === undefined || isRawPercentileRank(t.percentileRank))
  );
}

function isRawBadge(value: unknown): value is MetricBadge {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const b = value as MetricBadge;
  return (
    typeof b.name === "string" &&
    typeof b.nameEn === "string" &&
    typeof b.author === "string" &&
    typeof b.summary === "string" &&
    typeof b.detail === "string" &&
    (b.timeframe === undefined || typeof b.timeframe === "string") &&
    (b.sourceUrl === undefined || typeof b.sourceUrl === "string") &&
    isRawBadgeThreshold(b.threshold)
  );
}

interface RawPitMetric {
  metricCode: string;
  /** Renamed from displayName 2026-09-13 — confirmed live, analysis-ts did not announce this ahead of time. */
  name: string;
  /**
   * 英文縮寫，2026-09-26（他們的 commit 747feb18）起有值。選填，目前 64 支有——不要提升成必填，
   * 那會讓沒有縮寫的指標整批同步失敗（badge 的必填欄位曾經就是這樣炸掉整份型錄的，見
   * project_badge_threshold_warning_sync_outage）。
   */
  nameEn?: string;
  /** 區分同名指標的後綴（「即時」／「交易所」／「Greenblatt」／「非製造業版」），156 支裡 7 支有。 */
  nameSuffix?: string;
  unit: string;
  /** Renamed from validTokens 2026-09-14, alongside the token->timeframe query-param rename (see fetchMetricHistory/fetchMetricsHistory) — same "timeframe" terminology throughout. */
  validTimeframes: string[];
  /** Absent entirely (not an empty string) for metrics without a documented formula yet — pilot rollout, 2026-09-10. */
  formulaLatex?: string;
  /** Metric-level tooltip text — added 2026-09-19 alongside limitations/misreadings, present on the ~35 badge metrics first. */
  description?: string;
  /** What this metric can't tell you — added 2026-09-19, same badge-metrics-first coverage as description. */
  limitations?: string;
  /** Common ways this metric gets misread/misapplied — added 2026-09-19, same badge-metrics-first coverage as description. */
  misreadings?: string;
  /** Absent entirely (not an empty string) for metrics without a documented reference link yet, 2026-09-10. */
  referenceUrl?: string;
  /** Present only on the ~13 metrics with a documented academic paper source, 2026-09-10. */
  academicSourceUrl?: string;
  /** Present only on the ~11 metrics with a curated "guru badge" methodology threshold, 2026-09-10. */
  badge?: MetricBadge;
  /** Data-provenance category labels — a fixed 9-label vocabulary, required and non-empty on every metric (2026-09-10). */
  sources: string[];
  /**
   * Whether GET /companies/:symbol/metric-provenance supports this metricCode — added 2026-09-13, present
   * (true or false) on every metric, not a "not every metric has one yet" field like formulaLatex/
   * referenceUrl/badge. A growing allowlist (12 metrics at launch) — read off this field, never hardcoded.
   */
  hasProvenance: boolean;
  /**
   * The metric's current formula version — the same integer analysis-ts stamps on every metric_values row
   * it computes (added 2026-09-22, present on every metric). Bumps when the computation changes (e.g. sue's
   * drift-term removal → 3, the period-average-denominator batch → 2); web-nuxt uses it as a "re-read the
   * copy" signal. Required like hasProvenance, not a sparse field.
   */
  formulaVersion: number;
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
            typeof (m as RawPitMetric).name === "string" &&
            typeof (m as RawPitMetric).unit === "string" &&
            Array.isArray((m as RawPitMetric).validTimeframes) &&
            (m as RawPitMetric).validTimeframes.every((t) => typeof t === "string") &&
            ((m as RawPitMetric).formulaLatex === undefined || typeof (m as RawPitMetric).formulaLatex === "string") &&
            ((m as RawPitMetric).description === undefined || typeof (m as RawPitMetric).description === "string") &&
            ((m as RawPitMetric).limitations === undefined || typeof (m as RawPitMetric).limitations === "string") &&
            ((m as RawPitMetric).misreadings === undefined || typeof (m as RawPitMetric).misreadings === "string") &&
            ((m as RawPitMetric).referenceUrl === undefined || typeof (m as RawPitMetric).referenceUrl === "string") &&
            ((m as RawPitMetric).academicSourceUrl === undefined || typeof (m as RawPitMetric).academicSourceUrl === "string") &&
            ((m as RawPitMetric).badge === undefined || isRawBadge((m as RawPitMetric).badge)) &&
            Array.isArray((m as RawPitMetric).sources) &&
            (m as RawPitMetric).sources.every((s) => typeof s === "string") &&
            typeof (m as RawPitMetric).hasProvenance === "boolean" &&
            Number.isInteger((m as RawPitMetric).formulaVersion),
        ),
    )
  );
}

/**
 * Converts analysis-ts's pitMetrics-native `/filters` shape into this codebase's existing
 * MetricCategory/MetricDefinition/MetricField shape, so the rest of this domain (repository, screener field
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
 * `name`/`unit` (real Chinese labels, e.g. "殖利率（交易所公告）"/"%") landed on every one of the 64
 * metrics as of 2026-09-09 — used directly for the metric-level name/unit now instead of the metricCode
 * placeholder this client used from 2026-09-08 until copy shipped (this field was itself called
 * `displayName` on the wire until analysis-ts silently renamed it to `name` 2026-09-13, breaking sync
 * until caught here). `categoryDisplayName` (e.g. "股利" for
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
 * `academicSourceUrl` (2026-09-10, added alongside referenceUrl but on a narrower set of ~13 metrics) is
 * a DIFFERENT link, not a duplicate of referenceUrl — analysis-ts's own distinction: referenceUrl is a
 * general-reader explanation (often Wikipedia), academicSourceUrl points at the original academic paper
 * behind the methodology (e.g. sue's Foster/Olsen/Shevlin 1984 paper via a DOI link, or the Basel
 * III/IMF FSI banking-ratio source documents). web-nuxt prefers this over referenceUrl when both exist.
 * Same absent-not-empty-string and null-when-absent convention as the other two.
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
 *
 * `description` (metric-level tooltip text) started actually being sent by analysis-ts 2026-09-19 — this
 * field existed on MetricDefinition/the DB schema since the start (for a future "analysis-ts starts
 * sending it" case), but was hardcoded to `null` here until now because analysis-ts never populated it.
 * `limitations`/`misreadings` are genuinely new fields, added the same day, same sparse ~35-badge-metrics-
 * first coverage as badge/formulaLatex/referenceUrl when they first landed — undefined (not empty string)
 * on every other metric until analysis-ts documents more.
 */
function toMetricCategories(raw: RawPitCategory[]): MetricCategory[] {
  return raw.map((category, categoryIndex) => ({
    key: category.categoryKey,
    name: category.categoryDisplayName,
    sort: categoryIndex,
    metrics: category.metrics.map((metric, metricIndex) => ({
      key: metric.metricCode,
      name: metric.name,
      nameEn: metric.nameEn ?? null,
      nameSuffix: metric.nameSuffix ?? null,
      path: metric.metricCode,
      description: metric.description ?? null,
      source: null,
      limitations: metric.limitations ?? null,
      misreadings: metric.misreadings ?? null,
      unit: metric.unit,
      formulaLatex: metric.formulaLatex ?? null,
      referenceUrl: metric.referenceUrl ?? null,
      academicSourceUrl: metric.academicSourceUrl ?? null,
      badge: metric.badge ?? null,
      sources: metric.sources,
      hasProvenance: metric.hasProvenance,
      formulaVersion: metric.formulaVersion,
      sort: metricIndex,
      fields: metric.validTimeframes.map((token, tokenIndex) => ({
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
 * Fetches the metric category/definition/field catalog from oingg-analysis-ts's `/metrics` endpoint —
 * renamed from `/filters` 2026-09-10 (their reasoning: the response is metric definitions, not filters
 * themselves; response shape unchanged). Unlike the basis->token/periodType rename (a pure internal
 * wire-format change, shielded from web-nuxt — see [[project_basis_field_split_migration]]), this one
 * carries domain-language significance, so bff-ts's own public path was renamed too (`GET /filters` ->
 * `GET /metrics`, same day) — for ubiquitous language, so cross-team communication doesn't end up with
 * two names for the same thing. This module/its types followed suit 2026-09-11 (Filter* -> Metric*
 * internally too — see [[feedback_mirror_ubiquitous_language_renames]]).
 */
export async function fetchMetricCatalog(): Promise<MetricCategory[]> {
  const url = buildAnalysisServiceUrl("/metrics");
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Metrics service");

  const body: unknown = await response.json();
  const categories = (body as { categories?: unknown } | null)?.categories;
  if (!isRawPitCategoryArray(categories)) {
    logger.error({ url: url.toString() }, 'Metrics service response is missing a valid "categories" array');
    throw new AppError('Metrics service response is missing a valid "categories" array', 502);
  }

  return toMetricCategories(categories);
}

/**
 * MetricCatalogGatewayPort 的實作。
 *
 * 跟 analysisMacroGateway 一樣只是把 fetchX 對應到 port 的方法名——上面的 fetchMetricCatalog 已經做完
 * 形狀驗證、502 判定與 pitMetrics -> MetricCategory 的翻譯，所以這裡沒有第二層殼。
 */
export const analysisMetricCatalogGateway: MetricCatalogGatewayPort = {
  fetchCatalog: fetchMetricCatalog,
};
