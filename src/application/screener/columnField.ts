import { parseFieldRef, toFieldRefString } from "@/shared/fieldRef.js";
import type { AppDeps } from "@/application/deps.js";

/**
 * Only the catalog port: this module owns no rows, it turns "metricCode.token" strings into something a
 * column header can show. Taken as the LAST argument, same convention as the services that call it.
 */
export type ColumnFieldDeps = Pick<AppDeps, "metricCatalog">;

export interface ColumnFieldInfo {
  field: string;
  metricName: string;
  fieldName: string;
  kind: "catalog" | "special";
}

/**
 * Non-metricCatalog columns the screener can also display. Currently just the stock's latest close
 * price, which lives in the twse/tpex `daily_price` tables — a different source than the analysis DB
 * everything else here comes from, so it can't be resolved through the catalog port at all.
 * Add here (and wire the actual join in screener.service.ts) when a new non-catalog column is needed.
 */
export const SPECIAL_COLUMNS: Record<string, { metricName: string; fieldName: string; unit: string | null }> = {
  "stock.price": { metricName: "股票", fieldName: "股價", unit: "currency" },
};

/**
 * Resolves a batch of column field references for display purposes — each one is either a catalog field
 * or a special one (see above); null for a field that is neither. Looks up every non-special field in a
 * single query instead of one per field: a column preset's fields (and a whole list of presets' fields,
 * since each row's columns get resolved for display) used to pay one round trip per field just to attach
 * display names.
 */
export async function resolveColumnFields(
  fields: string[],
  deps: ColumnFieldDeps,
): Promise<Map<string, ColumnFieldInfo | null>> {
  const results = new Map<string, ColumnFieldInfo | null>();
  const catalogRefs: Array<{ field: string; metricKey: string; fieldKey: string }> = [];

  for (const field of fields) {
    const special = SPECIAL_COLUMNS[field];
    if (special) {
      results.set(field, { field, metricName: special.metricName, fieldName: special.fieldName, kind: "special" });
    } else {
      const { metricKey, fieldKey } = parseFieldRef(field);
      catalogRefs.push({ field, metricKey, fieldKey });
    }
  }

  if (catalogRefs.length > 0) {
    const found = await deps.metricCatalog.findFields(catalogRefs);
    const foundByKey = new Map(found.map((f) => [toFieldRefString(f.metricKey, f.fieldKey), f]));

    for (const ref of catalogRefs) {
      const lookup = foundByKey.get(toFieldRefString(ref.metricKey, ref.fieldKey));
      results.set(
        ref.field,
        lookup ? { field: ref.field, metricName: lookup.metricName, fieldName: lookup.fieldName, kind: "catalog" } : null,
      );
    }
  }

  return results;
}
