/** One derived field's formula/inputs, as documented by analysis-ts itself — not computed by bff-ts. */
export interface PreferredStockFieldCatalogEntry {
  field: string;
  label: string;
  formula: string;
  inputs: string[];
}

export interface PreferredStockFieldCatalogResult {
  fields: PreferredStockFieldCatalogEntry[];
}
