import { addColumnPresetWithName } from "../screener/columnPresets.service.js";
import type { ColumnPresetView } from "../screener/columnPresets.service.js";
import { fetchColumnPresetTemplates } from "./columnPresetTemplates.client.js";
import {
  findColumnPresetTemplate,
  listColumnPresetTemplates,
  replaceColumnPresetTemplates,
} from "./columnPresetTemplates.repository.js";
import { AppError } from "../../shared/errorHandler.js";
import type { ColumnPresetTemplate } from "./columnPresetTemplates.types.js";

const RETRY_DELAY_MS = 30_000;

/** Serves the templates to the frontend from our own DB — never proxies live to oingg-analysis-ts. */
export async function getColumnPresetTemplates(): Promise<ColumnPresetTemplate[]> {
  return listColumnPresetTemplates();
}

export async function getColumnPresetTemplateOrThrow(key: string): Promise<ColumnPresetTemplate> {
  const template = await findColumnPresetTemplate(key);
  if (!template) {
    throw new AppError(`Column preset template "${key}" not found`, 404);
  }
  return template;
}

/**
 * Clones a template's fieldKeys into a new personal ColumnPreset owned by the caller, named after the
 * template (falling through to "name 2", "name 3", ... on collision — see addColumnPresetWithName). Field
 * validity is checked there too, so a template referencing a field the catalog has since dropped surfaces
 * as a normal 400, not a silent partial apply.
 */
export async function applyColumnPresetTemplate(firebaseUid: string, key: string): Promise<ColumnPresetView> {
  const template = await getColumnPresetTemplateOrThrow(key);
  return addColumnPresetWithName(firebaseUid, template.name, template.fieldKeys);
}

export interface ColumnPresetTemplateSyncSummary {
  templateCount: number;
}

/** Fetches the curated columnPresets from the filters service and stores them in the BFF's own database. */
export async function syncColumnPresetTemplates(): Promise<ColumnPresetTemplateSyncSummary> {
  const templates = await fetchColumnPresetTemplates();
  await replaceColumnPresetTemplates(templates);

  console.log(`Synced column preset templates: ${templates.length} templates`);
  return { templateCount: templates.length };
}

/**
 * Fire-and-forget sync with a single retry, called once at startup — same mechanism and rationale as
 * filterCatalog's startFilterCatalogSync (oingg-analysis-ts must never know oingg-bff-ts exists, so this
 * side is the only one that can initiate keeping this list fresh; freshness is bounded by how often this
 * process restarts).
 */
export function startColumnPresetTemplateSync(retriesLeft = 1): void {
  syncColumnPresetTemplates().catch((error: unknown) => {
    if (retriesLeft > 0) {
      console.warn(
        `Column preset template sync failed, keeping existing data and retrying in ${RETRY_DELAY_MS / 1000}s:`,
        error,
      );
      setTimeout(() => startColumnPresetTemplateSync(retriesLeft - 1), RETRY_DELAY_MS);
    } else {
      console.error("Column preset template sync failed again, giving up until the next restart:", error);
    }
  });
}
