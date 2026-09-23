import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import { addPresetWithName } from "@/application/screener/screenerPresets.service.js";
import type { PresetView } from "@/application/screener/screenerPresets.service.js";
import type { PresetTemplate } from "@/application/presetTemplates/presetTemplates.types.js";

/**
 * `screenerPresets` is in here because applying a template *creates a personal preset* — this use case
 * calls addPresetWithName rather than writing rows itself, so it has to hand that use case the port it
 * needs. application→application is fine (both sides are use cases); what would not be fine is this
 * slice reaching for the preset repository directly and duplicating the naming/retry rules.
 */
export type PresetTemplatesDeps = Pick<AppDeps, "presetTemplates" | "screenerPresets">;

export async function getPresetTemplates(deps: PresetTemplatesDeps): Promise<PresetTemplate[]> {
  return deps.presetTemplates.list();
}

export async function getPresetTemplateOrThrow(id: string, deps: PresetTemplatesDeps): Promise<PresetTemplate> {
  const template = await deps.presetTemplates.find(id);
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
export async function applyPresetTemplate(
  firebaseUid: string,
  templateId: string,
  deps: PresetTemplatesDeps,
): Promise<PresetView> {
  const template = await getPresetTemplateOrThrow(templateId, deps);
  if (template.status !== "AVAILABLE") {
    throw new AppError(
      `Preset template "${template.name}" isn't runnable yet${template.pendingReason ? `: ${template.pendingReason}` : ""}`,
      409,
    );
  }
  return addPresetWithName(firebaseUid, template.name, template.filters, deps);
}
