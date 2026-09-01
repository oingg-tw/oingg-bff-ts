import { AppError } from "@/shared/errorHandler.js";
import { addPresetWithName } from "@/domains/screener/screenerPresets.service.js";
import type { PresetView } from "@/domains/screener/screenerPresets.service.js";
import { findPresetTemplate, listPresetTemplates } from "@/domains/presetTemplates/presetTemplates.repository.js";
import type { PresetTemplate } from "@/domains/presetTemplates/presetTemplates.types.js";

export async function getPresetTemplates(): Promise<PresetTemplate[]> {
  return listPresetTemplates();
}

export async function getPresetTemplateOrThrow(id: string): Promise<PresetTemplate> {
  const template = await findPresetTemplate(id);
  if (!template) {
    throw new AppError(`Preset template ${id} not found`, 404);
  }
  return template;
}

/**
 * Clones a template's filters into a new personal ScreenerPreset owned by the caller, named after the
 * template (falling through to "name 2", "name 3", ... on collision — see addPresetWithName). A PENDING
 * template has no real filters to clone (see PresetTemplate.status/pendingReason), so applying one is
 * rejected with a 409 rather than silently creating an empty or broken preset.
 */
export async function applyPresetTemplate(firebaseUid: string, templateId: string): Promise<PresetView> {
  const template = await getPresetTemplateOrThrow(templateId);
  if (template.status !== "AVAILABLE") {
    throw new AppError(
      `Preset template "${template.name}" isn't runnable yet${template.pendingReason ? `: ${template.pendingReason}` : ""}`,
      409,
    );
  }
  return addPresetWithName(firebaseUid, template.name, template.filters);
}
