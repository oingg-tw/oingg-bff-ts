/**
 * The stored shape of a user's saved filter combo, as the port hands it over.
 *
 * Deliberately *not* the API shape (see PresetView in screenerPresets.service.ts): filters are stored
 * split into (metricKey, fieldKey) and only joined back into a "metricKey.fieldKey" string for the wire.
 * Dates are already ISO strings — turning a Date into a string is a storage detail, so it happens in the
 * adapter, not in the use case.
 */
export interface PresetFilterRow {
  metricKey: string;
  fieldKey: string;
  min: number | null;
  max: number | null;
  exclude: boolean;
}

export interface PresetRow {
  id: string;
  name: string;
  filters: PresetFilterRow[];
  sectorCodes: string[];
  excludeSectorCodes: string[];
  lastColumnPresetId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What a filter looks like on the way in — same fields as PresetFilterRow, named apart so the direction stays readable at call sites. */
export interface PresetFilterInput {
  metricKey: string;
  fieldKey: string;
  min: number | null;
  max: number | null;
  exclude: boolean;
}

/**
 * Every field is optional and `undefined` means "don't touch it" — a PATCH only sends what changed.
 * `filters` is the exception to partial semantics: when given it replaces the whole set (including with
 * an empty array), never merges.
 */
export interface PresetUpdate {
  name?: string;
  filters?: PresetFilterInput[];
  sectorCodes?: string[];
  excludeSectorCodes?: string[];
}
