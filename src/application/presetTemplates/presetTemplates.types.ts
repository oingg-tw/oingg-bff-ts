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
  /**
   * Stable, URL-safe identifier decoupled from `name` — added 2026-09-20 after a `name` rename ("股利穩健"
   * -> "股利連續性") silently broke web-nuxt's /screener/{slug} routing (they had been keying off `name`,
   * the only string identifier available at the time). web-nuxt's own SCREENER_TEMPLATE_SLUGS is the
   * authoritative source for these values. `name`/`description` can be revised freely without notice now
   * that routing doesn't depend on them; changing `slug` itself is still a breaking change for web-nuxt.
   */
  slug: string;
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
