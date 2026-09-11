import { fetchMetricCatalog } from "@/domainBusiness/metricCatalog/metricCatalog.client.js";
import { listMetricCatalog, replaceMetricCatalog } from "@/domainBusiness/metricCatalog/metricCatalog.repository.js";
import type { MetricCategory } from "@/domainBusiness/metricCatalog/metricCatalog.types.js";
import { logger } from "@/shared/logger.js";

const RETRY_DELAY_MS = 30_000;

/** Serves the catalog to the frontend from our own DB — never proxies live to oingg-analysis-ts. */
export async function getMetricCatalog(): Promise<MetricCategory[]> {
  return listMetricCatalog();
}

export interface MetricCatalogSyncSummary {
  categoryCount: number;
  metricCount: number;
}

/**
 * Fetches the metric catalog from analysis-ts's /metrics endpoint and stores it in the BFF's own database.
 *
 * Refuses to apply an empty catalog (2026-09-08: analysis-ts's own /filters, since renamed /metrics,
 * briefly returned `categories: []` mid-migration) — `replaceMetricCatalog([])` would otherwise delete
 * every MetricCategory/MetricDefinition/MetricDefinitionField row, which cascades into
 * ScreenerPresetFilter and destroys every user's saved filter conditions, not just empties the catalog
 * UI. An upstream response with zero categories is far more likely to be a transient/mid-deploy state
 * than "there are now genuinely no filterable fields at all", so this is treated as a sync failure (kept
 * + retried by the caller) rather than valid data to apply.
 */
export async function syncMetricCatalog(): Promise<MetricCatalogSyncSummary> {
  const categories = await fetchMetricCatalog();
  if (categories.length === 0) {
    throw new Error("Metrics service returned an empty catalog (0 categories) — refusing to wipe local data");
  }

  await replaceMetricCatalog(categories);

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
 */
export function startMetricCatalogSync(retriesLeft = 1): void {
  syncMetricCatalog().catch((error: unknown) => {
    if (retriesLeft > 0) {
      logger.warn(
        { err: error },
        `Metric catalog sync failed, keeping existing data and retrying in ${RETRY_DELAY_MS / 1000}s`,
      );
      setTimeout(() => startMetricCatalogSync(retriesLeft - 1), RETRY_DELAY_MS);
    } else {
      logger.error({ err: error }, "Metric catalog sync failed again, giving up until the next restart");
    }
  });
}
