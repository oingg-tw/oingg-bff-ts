import { AppError } from "../../shared/errorHandler.js";
import { requireEnv } from "../../shared/env.js";
import type { ColumnPresetTemplate } from "./columnPresetTemplates.types.js";

function isColumnPresetTemplateArray(value: unknown): value is ColumnPresetTemplate[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ColumnPresetTemplate).key === "string" &&
        typeof (item as ColumnPresetTemplate).name === "string" &&
        typeof (item as ColumnPresetTemplate).description === "string" &&
        Array.isArray((item as ColumnPresetTemplate).fieldKeys) &&
        (item as ColumnPresetTemplate).fieldKeys.every((f) => typeof f === "string"),
    )
  );
}

/**
 * Fetches the curated columnPresets from oingg-analysis-ts's `/filters` endpoint — same endpoint
 * filterCatalog.client.ts reads `categories` from, just a different top-level field. A separate request
 * (rather than sharing filterCatalog's single fetch) keeps the two sync flows independent, at the cost of
 * one extra GET at startup — negligible since this only runs once per process start.
 */
export async function fetchColumnPresetTemplates(): Promise<ColumnPresetTemplate[]> {
  const url = new URL("/filters", requireEnv("FILTERS_SERVICE_URL"));

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new AppError(
      `Could not reach the analysis service at ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }

  if (!response.ok) {
    throw new AppError(`Filters service returned ${response.status} for ${url.toString()}`, 502);
  }

  const body: unknown = await response.json();
  const columnPresets = (body as { columnPresets?: unknown } | null)?.columnPresets;
  if (!isColumnPresetTemplateArray(columnPresets)) {
    throw new AppError(`Filters service response at ${url.toString()} is missing a "columnPresets" array`, 502);
  }

  return columnPresets;
}
