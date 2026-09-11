export interface ColumnPresetTemplate {
  key: string;
  name: string;
  description: string;
  /** "<metricKey>.<fieldKey>" refs, same format ColumnPreset's own columns use. */
  fieldKeys: string[];
  /**
   * The neutral "overview" template the frontend shows before a user has picked anything, and the
   * screener's own fallback column set when no columnPresetId is given (see
   * columnPresetTemplates.repository.ts's findDefaultColumnPresetTemplate). Exactly one row must have
   * this true — curated locally via prisma/seedColumnPresetTemplates.ts (this table has been purely
   * bff-ts-owned since analysis-ts dropped its own columnPresets field entirely, 2026-09-08), enforced
   * by an assertion in that seed script, not by this type or the DB.
   */
  isDefault: boolean;
}
