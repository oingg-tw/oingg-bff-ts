import { fetchFilterCatalog } from "./filterCatalog.client.js";
import { listFilterCatalog, replaceFilterCatalog } from "./filterCatalog.repository.js";
import type { FilterCategory } from "./filterCatalog.types.js";

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
  console.log(`Synced filter catalog: ${categories.length} categories, ${metricCount} metrics`);
  return { categoryCount: categories.length, metricCount };
}

/**
 * Fire-and-forget sync with a single retry. The filters service (oingg-analysis-ts) may still be
 * booting or briefly unreachable — that's not fatal: the BFF keeps serving whatever catalog it already
 * has (or none yet). One retry covers "just needed a moment to boot"; if it still fails after that,
 * give up rather than retrying forever.
 */
function startFilterCatalogSync(retriesLeft = 1): void {
  syncFilterCatalog().catch((error: unknown) => {
    if (retriesLeft > 0) {
      console.warn(
        `Filter catalog sync failed, keeping existing data and retrying in ${RETRY_DELAY_MS / 1000}s:`,
        error,
      );
      setTimeout(() => startFilterCatalogSync(retriesLeft - 1), RETRY_DELAY_MS);
    } else {
      console.error("Filter catalog sync failed again, giving up until oingg-analysis-ts pushes an update:", error);
    }
  });
}

/**
 * Call once at startup — NOT an unconditional resync. Normal operation keeps the catalog fresh via
 * oingg-analysis-ts calling POST /filters/sync whenever its own catalog changes (see
 * filterCatalog.routes.ts); this service no longer proactively re-pulls on every restart. The one
 * exception is a brand-new deployment with an empty local catalog — nothing to fall back on until
 * analysis-ts happens to push next — so this still runs one bootstrap sync in that specific case,
 * fire-and-forget, never blocking or failing startup.
 */
export async function bootstrapFilterCatalogIfEmpty(): Promise<void> {
  try {
    const existing = await listFilterCatalog();
    if (existing.length === 0) {
      console.log("Filter catalog is empty (first boot?) — running a one-time bootstrap sync from oingg-analysis-ts.");
      startFilterCatalogSync();
    }
  } catch (error) {
    console.warn("Could not check whether the filter catalog needs a bootstrap sync, skipping:", error);
  }
}
