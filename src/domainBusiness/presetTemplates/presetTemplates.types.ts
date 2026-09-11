export type PresetTemplateTier = "FREE" | "PAID";
export type PresetTemplateStatus = "AVAILABLE" | "PENDING";

export interface PresetTemplateFilter {
  field: string;
  min: number | null;
  max: number | null;
  exclude: boolean;
}

export interface PresetTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  tier: PresetTemplateTier;
  status: PresetTemplateStatus;
  pendingReason: string | null;
  filters: PresetTemplateFilter[];
  /**
   * Shown/pre-selected when a user opens the screener for the first time with no filters chosen yet —
   * same isDefault convention as ColumnPresetTemplate, but a frontend discoverability signal only:
   * bff-ts does not auto-apply this filter server-side (POST /screener still requires at least one
   * explicit filter). Exactly one template has this true.
   */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
