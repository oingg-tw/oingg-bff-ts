import { addColumnPresetWithName } from "@/application/screener/columnPresets.service.js";
import type { ColumnPresetView } from "@/application/screener/columnPresets.service.js";
import { findColumnPresetTemplate, listColumnPresetTemplates } from "@/infrastructure/prisma/repositories/columnPresetTemplates.repository.js";
import { AppError } from "@/domain/appError.js";
import type { ColumnPresetTemplate } from "@/application/columnPresetTemplates/columnPresetTemplates.types.js";

/** Serves the templates to the frontend from our own DB — curated locally via prisma/seedColumnPresetTemplates.ts, never synced from analysis-ts (see that script's doc comment for why). */
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
