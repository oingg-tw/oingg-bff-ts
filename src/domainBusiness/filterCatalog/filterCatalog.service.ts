import { fetchFilterCatalog } from "@/domainBusiness/filterCatalog/filterCatalog.client.js";
import { listFilterCatalog, replaceFilterCatalog } from "@/domainBusiness/filterCatalog/filterCatalog.repository.js";
import type { FilterCategory } from "@/domainBusiness/filterCatalog/filterCatalog.types.js";
import { logger } from "@/shared/logger.js";

const RETRY_DELAY_MS = 30_000;

/** Serves the catalog to the frontend from our own DB — never proxies live to oingg-analysis-ts. */
export async function getFilterCatalog(): Promise<FilterCategory[]> {
  return listFilterCatalog();
}

export interface FilterCatalogSyncSummary {
  categoryCount: number;
  metricCount: number;
}

/**
 * Fetches the filter catalog from the filters service and stores it in the BFF's own database.
 *
 * Refuses to apply an empty catalog (2026-09-08: analysis-ts's own /filters briefly returned
 * `categories: []` mid-migration) — `replaceFilterCatalog([])` would otherwise delete every
 * FilterCategory/FilterMetric/FilterMetricField row, which cascades into ScreenerPresetFilter and
 * destroys every user's saved filter conditions, not just empties the catalog UI. An upstream response
 * with zero categories is far more likely to be a transient/mid-deploy state than "there are now
 * genuinely no filterable fields at all", so this is treated as a sync failure (kept + retried by the
 * caller) rather than valid data to apply.
 */
export async function syncFilterCatalog(): Promise<FilterCatalogSyncSummary> {
  const categories = await fetchFilterCatalog();
  if (categories.length === 0) {
    throw new Error("Filters service returned an empty catalog (0 categories) — refusing to wipe local data");
  }

  await replaceFilterCatalog(categories);

  const metricCount = categories.reduce((sum, category) => sum + category.metrics.length, 0);
  logger.info(`Synced filter catalog: ${categories.length} categories, ${metricCount} metrics`);
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
export function startFilterCatalogSync(retriesLeft = 1): void {
  syncFilterCatalog().catch((error: unknown) => {
    if (retriesLeft > 0) {
      logger.warn(
        { err: error },
        `Filter catalog sync failed, keeping existing data and retrying in ${RETRY_DELAY_MS / 1000}s`,
      );
      setTimeout(() => startFilterCatalogSync(retriesLeft - 1), RETRY_DELAY_MS);
    } else {
      logger.error({ err: error }, "Filter catalog sync failed again, giving up until the next restart");
    }
  });
}
