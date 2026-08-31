import { getPrismaClient } from "../../adapters/neon/index.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { FilterCategory } from "./filterCatalog.types.js";

export interface FilterFieldLookup {
  categoryKey: string;
  metricKey: string;
  metricName: string;
  fieldKey: string;
  fieldName: string;
  period: string;
}

export interface FieldRefInput {
  metricKey: string;
  fieldKey: string;
}

/** Looks up a single catalog field by (metricKey, fieldKey) — used to validate screener filters/columns. */
export async function findFilterField(metricKey: string, fieldKey: string): Promise<FilterFieldLookup | null> {
  const [field] = await findFilterFields([{ metricKey, fieldKey }]);
  return field ?? null;
}

/**
 * Looks up several catalog fields in one round trip instead of one query per field — the app DB is a
 * remote Neon Postgres, so validating e.g. a 5-filter preset one field at a time paid 5x the network
 * round-trip latency for no benefit (even run concurrently via Promise.all, since each concurrent query
 * still needs its own connection out to Neon). Returns only the fields that were found; callers compare
 * against what they asked for to report which ones are missing.
 */
export async function findFilterFields(refs: FieldRefInput[]): Promise<FilterFieldLookup[]> {
  if (refs.length === 0) {
    return [];
  }

  const prisma = getPrismaClient();
  const fields = await prisma.filterMetricField.findMany({
    where: { OR: refs.map((ref) => ({ metricKey: ref.metricKey, key: ref.fieldKey })) },
    include: { metric: true },
  });

  return fields.map((field) => ({
    categoryKey: field.metric.categoryKey,
    metricKey: field.metric.key,
    metricName: field.metric.name,
    fieldKey: field.key,
    fieldName: field.name,
    period: field.period,
  }));
}

/** Full catalog for the frontend (GET /filters), in the same category→metric→field shape and order as the source /filters response. */
export async function listFilterCatalog(): Promise<FilterCategory[]> {
  const prisma = getPrismaClient();
  const categories = await prisma.filterCategory.findMany({
    orderBy: { position: "asc" },
    include: {
      metrics: {
        orderBy: { position: "asc" },
        include: { fields: { orderBy: { position: "asc" } } },
      },
    },
  });

  return categories.map((category) => ({
    key: category.key,
    name: category.name,
    sort: category.position,
    metrics: category.metrics.map((metric) => ({
      key: metric.key,
      name: metric.name,
      path: metric.path,
      description: metric.description,
      source: metric.source,
      sort: metric.position,
      // oingg-analysis-ts fills description/source at the metric level only (the different period
      // variants of one metric — quarterly/TTM/etc — share the same definition and source, so it
      // doesn't repeat itself per field). A field without its own falls back to its metric's, so the
      // frontend can always just read field.description/field.source without knowing this convention.
      fields: metric.fields.map((field) => ({
        key: field.key,
        name: field.name,
        period: field.period,
        description: field.description ?? metric.description,
        source: field.source ?? metric.source,
        sort: field.position,
      })),
    })),
  }));
}

/**
 * Upserts the whole catalog by natural key (category key / metric key / [metricKey, fieldKey]) and
 * deletes only rows genuinely absent from the new catalog — NOT a delete-everything-then-recreate.
 *
 * This used to `deleteMany()` + `createMany()` every table on every sync (called once at every server
 * startup, see startFilterCatalogSync). FilterMetricField has `onDelete: Cascade` into
 * ScreenerPresetFilter (a saved preset can't reference a field the catalog doesn't have), so deleting
 * and recreating a field — even with the exact same key and data — destroyed every user's saved filter
 * conditions on every restart; ScreenerPreset rows survived with an empty `filters` array. Upserting in
 * place keeps a kept field's row (and therefore its id) untouched, so existing ScreenerPresetFilter rows
 * pointing at it are never cascaded away. A field that's genuinely removed upstream is still deleted
 * (correctly cascading away any preset filter that referenced it — it has nothing left to point at).
 *
 * Each of the three upserts and three deletes is a single batched statement (not one query per row),
 * for the same reason the old createMany-per-table version was — Prisma's interactive-transaction
 * timeout against a real Neon connection.
 */
export async function replaceFilterCatalog(categories: FilterCategory[]): Promise<void> {
  const prisma = getPrismaClient();

  const categoryRows = categories.map((category, position) => ({
    key: category.key,
    name: category.name,
    position,
  }));

  const metricRows = categories.flatMap((category) =>
    category.metrics.map((metric, position) => ({
      key: metric.key,
      categoryKey: category.key,
      name: metric.name,
      path: metric.path,
      description: metric.description ?? null,
      source: metric.source ?? null,
      position,
    })),
  );

  const fieldRows = categories.flatMap((category) =>
    category.metrics.flatMap((metric) =>
      metric.fields.map((field, position) => ({
        metricKey: metric.key,
        key: field.key,
        name: field.name,
        period: field.period,
        description: field.description ?? null,
        source: field.source ?? null,
        position,
      })),
    ),
  );

  await prisma.$transaction(async (tx) => {
    if (categoryRows.length > 0) {
      await tx.$executeRaw`
        INSERT INTO filter_category (key, name, position)
        VALUES ${Prisma.join(categoryRows.map((c) => Prisma.sql`(${c.key}, ${c.name}, ${c.position})`))}
        ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position
      `;
    }

    if (metricRows.length > 0) {
      await tx.$executeRaw`
        INSERT INTO filter_metric (key, category_key, name, path, description, source, position)
        VALUES ${Prisma.join(
          metricRows.map(
            (m) =>
              Prisma.sql`(${m.key}, ${m.categoryKey}, ${m.name}, ${m.path}, ${m.description}, ${m.source}, ${m.position})`,
          ),
        )}
        ON CONFLICT (key) DO UPDATE SET
          category_key = EXCLUDED.category_key, name = EXCLUDED.name, path = EXCLUDED.path,
          description = EXCLUDED.description, source = EXCLUDED.source, position = EXCLUDED.position
      `;
    }

    if (fieldRows.length > 0) {
      await tx.$executeRaw`
        INSERT INTO filter_metric_field (metric_key, key, name, period, description, source, position)
        VALUES ${Prisma.join(
          fieldRows.map(
            (f) =>
              Prisma.sql`(${f.metricKey}, ${f.key}, ${f.name}, ${f.period}, ${f.description}, ${f.source}, ${f.position})`,
          ),
        )}
        ON CONFLICT (metric_key, key) DO UPDATE SET
          name = EXCLUDED.name, period = EXCLUDED.period, description = EXCLUDED.description,
          source = EXCLUDED.source, position = EXCLUDED.position
      `;
    }

    // Deepest first: a field/metric/category genuinely dropped from the new catalog is deleted here
    // (cascading away any preset filter that pointed at it), rather than earlier as part of a blanket wipe.
    await tx.filterMetricField.deleteMany({
      where:
        fieldRows.length > 0
          ? { NOT: { OR: fieldRows.map((f) => ({ metricKey: f.metricKey, key: f.key })) } }
          : {},
    });
    await tx.filterMetric.deleteMany({ where: { key: { notIn: metricRows.map((m) => m.key) } } });
    await tx.filterCategory.deleteMany({ where: { key: { notIn: categoryRows.map((c) => c.key) } } });
  });
}
