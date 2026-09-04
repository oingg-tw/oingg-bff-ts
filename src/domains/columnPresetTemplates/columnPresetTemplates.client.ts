import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { ColumnPresetTemplate } from "@/domains/columnPresetTemplates/columnPresetTemplates.types.js";

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
 */
export async function fetchColumnPresetTemplates(): Promise<ColumnPresetTemplate[]> {
  const url = buildAnalysisServiceUrl("/filters");
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Filters service");

  const body: unknown = await response.json();
  const columnPresets = (body as { columnPresets?: unknown } | null)?.columnPresets;
  if (!isRawColumnPresetTemplateArray(columnPresets)) {
    logger.error({ url: url.toString() }, 'Filters service response is missing a "columnPresets" array');
    throw new AppError('Filters service response is missing a "columnPresets" array', 502);
  }

  return columnPresets.map((template) => ({ ...template, isDefault: template.isDefault ?? false }));
}
