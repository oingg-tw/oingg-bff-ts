import { fetchFilterCatalog } from "./filterCatalog.client.js";
import { ensureFilterCatalogSchema, replaceFilterCatalog } from "./filterCatalog.repository.js";

/** Fetches the filter catalog from the filters service and stores it in the BFF's own database. Call once at startup. */
export async function syncFilterCatalog(): Promise<void> {
  await ensureFilterCatalogSchema();
  const categories = await fetchFilterCatalog();
  await replaceFilterCatalog(categories);

  const metricCount = categories.reduce((sum, category) => sum + category.metrics.length, 0);
  console.log(`Synced filter catalog: ${categories.length} categories, ${metricCount} metrics`);
}
