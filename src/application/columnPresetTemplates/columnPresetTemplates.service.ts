import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import { addColumnPresetWithName } from "@/application/screener/columnPresets.service.js";
import type { ColumnPresetView } from "@/application/screener/columnPresets.service.js";
import type { ColumnPresetTemplate } from "@/application/columnPresetTemplates/columnPresetTemplates.types.js";

/**
 * The extra two ports are what addColumnPresetWithName needs (ColumnPresetsDeps), not what this slice
 * reads itself: applying a template creates a personal ColumnPreset, so this use case calls that one and
 * has to hand over its dependencies — same arrangement as presetTemplates.service.ts.
 */
export type ColumnPresetTemplatesDeps = Pick<AppDeps, "columnPresetTemplates" | "columnPresets">;

/** Serves the templates to the frontend from our own DB — curated locally via prisma/seedColumnPresetTemplates.ts, never synced from analysis-ts (see that script's doc comment for why). */
export async function getColumnPresetTemplates(deps: ColumnPresetTemplatesDeps): Promise<ColumnPresetTemplate[]> {
  return deps.columnPresetTemplates.list();
}

export async function getColumnPresetTemplateOrThrow(
  key: string,
  deps: ColumnPresetTemplatesDeps,
): Promise<ColumnPresetTemplate> {
  const template = await deps.columnPresetTemplates.find(key);
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
export async function applyColumnPresetTemplate(
  firebaseUid: string,
  key: string,
  deps: ColumnPresetTemplatesDeps,
): Promise<ColumnPresetView> {
  const template = await getColumnPresetTemplateOrThrow(key, deps);
  return addColumnPresetWithName(firebaseUid, template.name, template.fieldKeys, deps);
}
