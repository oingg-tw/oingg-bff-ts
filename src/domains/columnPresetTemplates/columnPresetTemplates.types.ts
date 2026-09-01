export interface ColumnPresetTemplate {
  key: string;
  name: string;
  description: string;
  /** "<metricKey>.<fieldKey>" refs, same format ColumnPreset's own columns use. */
  fieldKeys: string[];
}
