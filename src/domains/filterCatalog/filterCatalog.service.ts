import { fetchFilterCatalog } from "./filterCatalog.client.js";
import { replaceFilterCatalog } from "./filterCatalog.repository.js";

const RETRY_DELAY_MS = 30_000;

/** Fetches the filter catalog from the filters service and stores it in the BFF's own database. */
export async function syncFilterCatalog(): Promise<void> {
  const categories = await fetchFilterCatalog();
  await replaceFilterCatalog(categories);

  const metricCount = categories.reduce((sum, category) => sum + category.metrics.length, 0);
  console.log(`Synced filter catalog: ${categories.length} categories, ${metricCount} metrics`);
}

/**
 * Fire-and-forget sync with indefinite retry. The filters service (oingg-analysis-ts) may still be
 * booting or briefly unreachable — that's not fatal: the BFF keeps serving whatever catalog it already
 * has (or none yet) and just tries again later, instead of blocking startup or crashing over it.
 * Call once at startup.
 */
export function startFilterCatalogSync(): void {
  syncFilterCatalog().catch((error: unknown) => {
    console.warn(
      `Filter catalog sync failed, keeping existing data and retrying in ${RETRY_DELAY_MS / 1000}s:`,
      error,
    );
    setTimeout(startFilterCatalogSync, RETRY_DELAY_MS);
  });
}
