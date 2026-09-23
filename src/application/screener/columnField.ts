import { parseFieldRef, toFieldRefString } from "@/shared/fieldRef.js";
// findMetricFields still comes straight from the repository: the metricCatalog slice moved to ports
// 2026-09-24 and its barrel went away with it, but this lookup has no caller inside that slice, so
// there was nothing to put on MetricCatalogPort yet. Threading it in as a dep means widening this
// slice's public Deps types (and three neighbouring slices' that call into it) — that's the screener
// slice's own ports conversion, not this one. Until then this import is an acknowledged violation.
import { findMetricFields } from "@/infrastructure/prisma/repositories/metricCatalog.repository.js";

export interface ColumnFieldInfo {
  field: string;
  metricName: string;
  fieldName: string;
  kind: "catalog" | "special";
}

/**
 * Non-metricCatalog columns the screener can also display. Currently just the stock's latest close
 * price, which lives in the twse/tpex `daily_price` tables — a different source than the analysis DB
 * everything else here comes from, so it can't be resolved through findMetricField/ANALYSIS_METRIC_TABLES.
 * Add here (and wire the actual join in screener.service.ts) when a new non-catalog column is needed.
 */
export const SPECIAL_COLUMNS: Record<string, { metricName: string; fieldName: string; unit: string | null }> = {
  "stock.price": { metricName: "股票", fieldName: "股價", unit: "currency" },
};

/** Resolves a column field reference for display purposes — a catalog field OR a special one (see above). Returns null if neither. */
export async function resolveColumnField(field: string): Promise<ColumnFieldInfo | null> {
  const results = await resolveColumnFields([field]);
  return results.get(field) ?? null;
}

/**
 * Batched equivalent of resolveColumnField — looks up every non-special field in a single query instead
 * of one per field. A column preset's fields (and a whole list of presets' fields, since each row's
 * columns get resolved for display) used to pay one round trip per field just to attach display names.
 */
export async function resolveColumnFields(fields: string[]): Promise<Map<string, ColumnFieldInfo | null>> {
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
    const found = await findMetricFields(catalogRefs);
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
