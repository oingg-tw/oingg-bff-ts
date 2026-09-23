import type { AppDeps } from "@/application/deps.js";
import type { MetricCategory } from "@/application/metricCatalog/metricCatalog.types.js";
import { logger } from "@/shared/logger.js";

const RETRY_DELAY_MS = 30_000;

/** Reading the catalog needs only local storage — serving it never touches oingg-analysis-ts. */
export type MetricCatalogDeps = Pick<AppDeps, "metricCatalog">;

/** Syncing is the one direction that needs both: pull from the gateway, write through the storage port. */
export type MetricCatalogSyncDeps = Pick<AppDeps, "metricCatalog" | "metricCatalogGateway">;

/** Serves the catalog to the frontend from our own DB — never proxies live to oingg-analysis-ts. */
export async function getMetricCatalog(deps: MetricCatalogDeps): Promise<MetricCategory[]> {
  return deps.metricCatalog.list();
}

export interface MetricCatalogSyncSummary {
  categoryCount: number;
  metricCount: number;
}

/**
 * Fetches the metric catalog from analysis-ts's /metrics endpoint and stores it in the BFF's own database.
 *
 * Refuses to apply an empty catalog (2026-09-08: analysis-ts's own /filters, since renamed /metrics,
 * briefly returned `categories: []` mid-migration) — `metricCatalog.replace([])` would otherwise delete
 * every MetricCategory/MetricDefinition/MetricDefinitionField row, which cascades into
 * ScreenerPresetFilter and destroys every user's saved filter conditions, not just empties the catalog
 * UI. An upstream response with zero categories is far more likely to be a transient/mid-deploy state
 * than "there are now genuinely no filterable fields at all", so this is treated as a sync failure (kept
 * + retried by the caller) rather than valid data to apply.
 *
 * This guard lives here, above both ports, on purpose: it's a judgement about what upstream silence
 * means, not a storage detail. A version of it inside the repository would be invisible to anyone
 * reading the use case, and a version inside the client would make "empty" indistinguishable from
 * "malformed" to the retry logic below.
 */
export async function syncMetricCatalog(deps: MetricCatalogSyncDeps): Promise<MetricCatalogSyncSummary> {
  const categories = await deps.metricCatalogGateway.fetchCatalog();
  if (categories.length === 0) {
    throw new Error("Metrics service returned an empty catalog (0 categories) — refusing to wipe local data");
  }

  await deps.metricCatalog.replace(categories);

  const metricCount = categories.reduce((sum, category) => sum + category.metrics.length, 0);
  logger.info(`Synced metric catalog: ${categories.length} categories, ${metricCount} metrics`);
  return { categoryCount: categories.length, metricCount };
}

/**
 * Fire-and-forget sync with a single retry, called once at startup. oingg-analysis-ts (數據中台) must
 * never know oingg-bff-ts exists — there is deliberately no push/notify mechanism in the other
 * direction, so bff-ts is the only side that can initiate keeping this catalog fresh. A previous
 * version tried a POST /filters/sync endpoint for analysis-ts to call after its own catalog changed;
 * that was removed because it required analysis-ts's code to know about and call bff-ts, violating this
 * boundary. Until/unless a periodic re-sync is added, freshness is bounded by how often this process
 * restarts.
 *
 * The retry counter moved into the private helper below rather than staying an optional parameter here:
 * with `deps` as the last argument a defaulted `retriesLeft` in front of it could no longer be omitted
 * by callers, and it was never meant to be a caller's choice in the first place — it's this function's
 * own recursion bookkeeping.
 */
export function startMetricCatalogSync(deps: MetricCatalogSyncDeps): void {
  runSyncAttempt(1, deps);
}

function runSyncAttempt(retriesLeft: number, deps: MetricCatalogSyncDeps): void {
  syncMetricCatalog(deps).catch((error: unknown) => {
    if (retriesLeft > 0) {
      logger.warn(
        { err: error },
        `Metric catalog sync failed, keeping existing data and retrying in ${RETRY_DELAY_MS / 1000}s`,
      );
      setTimeout(() => runSyncAttempt(retriesLeft - 1, deps), RETRY_DELAY_MS);
    } else {
      logger.error({ err: error }, "Metric catalog sync failed again, giving up until the next restart");
    }
  });
}
