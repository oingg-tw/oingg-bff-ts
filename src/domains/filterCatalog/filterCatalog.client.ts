import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { FilterCategory } from "@/domains/filterCatalog/filterCatalog.types.js";

function isFilterCatalogResponse(body: unknown): body is { categories: FilterCategory[] } {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { categories?: unknown }).categories)
  );
}

/** Fetches the filter category/metric/field catalog from oingg-analysis-ts's `/filters` endpoint. */
export async function fetchFilterCatalog(): Promise<FilterCategory[]> {
  const url = buildAnalysisServiceUrl("/filters");
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Filters service");

  const body: unknown = await response.json();
  if (!isFilterCatalogResponse(body)) {
    logger.error({ url: url.toString() }, 'Filters service response is missing a "categories" array');
    throw new AppError('Filters service response is missing a "categories" array', 502);
  }

  return body.categories;
}
