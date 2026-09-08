import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { ColumnPresetTemplate } from "@/domainBusiness/columnPresetTemplates/columnPresetTemplates.types.js";

interface RawColumnPresetTemplate {
  key: string;
  name: string;
  description: string;
  fieldKeys: string[];
  /** analysis-ts sends this true on exactly one template and omits it on the rest — never sends false. */
  isDefault?: boolean;
}

function isRawColumnPresetTemplateArray(value: unknown): value is RawColumnPresetTemplate[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as RawColumnPresetTemplate).key === "string" &&
        typeof (item as RawColumnPresetTemplate).name === "string" &&
        typeof (item as RawColumnPresetTemplate).description === "string" &&
        Array.isArray((item as RawColumnPresetTemplate).fieldKeys) &&
        (item as RawColumnPresetTemplate).fieldKeys.every((f) => typeof f === "string") &&
        ((item as RawColumnPresetTemplate).isDefault === undefined ||
          typeof (item as RawColumnPresetTemplate).isDefault === "boolean"),
    )
  );
}

/**
 * Fetches the curated columnPresets from oingg-analysis-ts's `/filters` endpoint — same endpoint
 * filterCatalog.client.ts reads `categories` from, just a different top-level field. A separate request
 * (rather than sharing filterCatalog's single fetch) keeps the two sync flows independent, at the cost of
 * one extra GET at startup — negligible since this only runs once per process start.
 *
 * analysis-ts's 2026-09-08 pitMetrics rebuild dropped this field from `/filters` entirely (not even
 * present as an empty array — confirmed live) rather than migrating it; there is currently no curated
 * column-preset concept upstream at all. Treated as "zero templates" rather than a fetch failure, since
 * that's the actual current (if regrettable) state of the world, not an error to retry — if analysis-ts
 * reintroduces this field later, it picks back up automatically with no bff-ts change needed.
 */
export async function fetchColumnPresetTemplates(): Promise<ColumnPresetTemplate[]> {
  const url = buildAnalysisServiceUrl("/filters");
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Filters service");

  const body: unknown = await response.json();
  const columnPresets = (body as { columnPresets?: unknown } | null)?.columnPresets;
  if (columnPresets === undefined) {
    return [];
  }
  if (!isRawColumnPresetTemplateArray(columnPresets)) {
    logger.error({ url: url.toString() }, 'Filters service response has an invalid "columnPresets" array');
    throw new AppError('Filters service response has an invalid "columnPresets" array', 502);
  }

  return columnPresets.map((template) => ({ ...template, isDefault: template.isDefault ?? false }));
}
