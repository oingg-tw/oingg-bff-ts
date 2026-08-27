import { parseFieldRef } from "../../shared/fieldRef.js";
import { findFilterField } from "../filterCatalog/index.js";

export interface ColumnFieldInfo {
  field: string;
  metricName: string;
  fieldName: string;
  kind: "catalog" | "special";
}

/**
 * Non-filterCatalog columns the screener can also display. Currently just the stock's latest close
 * price, which lives in the twse/tpex `daily_price` tables — a different source than the analysis DB
 * everything else here comes from, so it can't be resolved through findFilterField/ANALYSIS_METRIC_TABLES.
 * Add here (and wire the actual join in screener.service.ts) when a new non-catalog column is needed.
 */
export const SPECIAL_COLUMNS: Record<string, { metricName: string; fieldName: string }> = {
  "stock.price": { metricName: "股票", fieldName: "股價" },
};

/** Resolves a column field reference for display purposes — a catalog field OR a special one (see above). Returns null if neither. */
export async function resolveColumnField(field: string): Promise<ColumnFieldInfo | null> {
  const special = SPECIAL_COLUMNS[field];
  if (special) {
    return { field, metricName: special.metricName, fieldName: special.fieldName, kind: "special" };
  }

  const { metricKey, fieldKey } = parseFieldRef(field);
  const lookup = await findFilterField(metricKey, fieldKey);
  if (!lookup) {
    return null;
  }
  return { field, metricName: lookup.metricName, fieldName: lookup.fieldName, kind: "catalog" };
}
