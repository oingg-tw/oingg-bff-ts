import { fetchFilterCatalog } from "@/domains/filterCatalog/filterCatalog.client.js";
import { listFilterCatalog, replaceFilterCatalog } from "@/domains/filterCatalog/filterCatalog.repository.js";
import type { FilterCategory } from "@/domains/filterCatalog/filterCatalog.types.js";
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

/** Fetches the filter catalog from the filters service and stores it in the BFF's own database. */
export async function syncFilterCatalog(): Promise<FilterCatalogSyncSummary> {
  const categories = await fetchFilterCatalog();
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
