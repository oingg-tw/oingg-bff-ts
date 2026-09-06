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
  createdAt: string;
  updatedAt: string;
}
