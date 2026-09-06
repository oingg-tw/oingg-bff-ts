export interface ColumnPresetTemplate {
  key: string;
  name: string;
  description: string;
  /** "<metricKey>.<fieldKey>" refs, same format ColumnPreset's own columns use. */
  fieldKeys: string[];
  /**
   * The neutral "overview" template the frontend shows before a user has picked anything — analysis-ts
   * sends this true on exactly one template ("overview"/總覽) and omits the field on the rest. We store
   * it as-is (defaulting a missing value to false) rather than enforcing "exactly one true" here; that
   * curation invariant belongs to analysis-ts, same as every other columnPreset content decision.
   */
  isDefault: boolean;
}
