/**
 * The stored shape of a user's saved display-column combo, as the port hands it over.
 *
 * `columns` is a flat array of "metricKey.fieldKey" refs in the user's own chosen order — the display
 * names shown next to each one aren't stored, they're resolved live against the metric catalog by the
 * use case (see columnPresets.service.ts's buildView), so a renamed metric doesn't leave stale labels
 * frozen in a preset row.
 */
export interface ColumnPresetRow {
  id: string;
  name: string;
  isDefault: boolean;
  columns: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Every field is optional and `undefined` means "don't touch it" — a PATCH only sends what changed.
 * `columns` is the exception to partial semantics: when given it replaces the whole set, never merges.
 */
export interface ColumnPresetUpdate {
  name?: string;
  columns?: string[];
  isDefault?: boolean;
}
