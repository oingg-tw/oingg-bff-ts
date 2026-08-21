import { AppError } from "../../shared/errorHandler.js";
import type { FilterCategory } from "./filterCatalog.types.js";

const DEFAULT_FILTERS_SERVICE_URL = "http://localhost:5000";

function getFiltersServiceUrl(): string {
  return process.env.FILTERS_SERVICE_URL ?? DEFAULT_FILTERS_SERVICE_URL;
}

function isFilterCatalogResponse(body: unknown): body is { categories: FilterCategory[] } {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { categories?: unknown }).categories)
  );
}

/** Fetches the filter category/metric/field catalog from oingg-analysis-ts's `/filters` endpoint. */
export async function fetchFilterCatalog(): Promise<FilterCategory[]> {
  const url = new URL("/filters", getFiltersServiceUrl());
  const response = await fetch(url);

  if (!response.ok) {
    throw new AppError(`Filters service returned ${response.status} for ${url.toString()}`, 502);
  }

  const body: unknown = await response.json();
  if (!isFilterCatalogResponse(body)) {
    throw new AppError(`Filters service response at ${url.toString()} is missing a "categories" array`, 502);
  }

  return body.categories;
}
