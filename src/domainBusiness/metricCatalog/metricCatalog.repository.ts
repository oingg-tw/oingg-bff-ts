import { getPrismaClient } from "@/adapters/neon/index.js";
import { Prisma } from "@/generated/prisma/client.js";
import type { MetricBadge, MetricCategory } from "@/domainBusiness/metricCatalog/metricCatalog.types.js";

export interface MetricFieldLookup {
  categoryKey: string;
  metricKey: string;
  metricName: string;
  fieldKey: string;
  fieldName: string;
  period: string;
  /** Field's own unit if set, else falls back to the metric's — see MetricField.unit/MetricDefinition.unit. */
  unit: string | null;
}

export interface FieldRefInput {
  metricKey: string;
  fieldKey: string;
}

/** Looks up a single catalog field by (metricKey, fieldKey) — used to validate screener filters/columns. */
export async function findMetricField(metricKey: string, fieldKey: string): Promise<MetricFieldLookup | null> {
  const [field] = await findMetricFields([{ metricKey, fieldKey }]);
  return field ?? null;
}

/**
 * Looks up several catalog fields in one round trip instead of one query per field — the app DB is a
 * remote Neon Postgres, so validating e.g. a 5-filter preset one field at a time paid 5x the network
 * round-trip latency for no benefit (even run concurrently via Promise.all, since each concurrent query
 * still needs its own connection out to Neon). Returns only the fields that were found; callers compare
 * against what they asked for to report which ones are missing.
 */
export async function findMetricFields(refs: FieldRefInput[]): Promise<MetricFieldLookup[]> {
  if (refs.length === 0) {
    return [];
  }

  const prisma = getPrismaClient();
  const fields = await prisma.metricDefinitionField.findMany({
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
    unit: field.unit ?? field.metric.unit ?? null,
  }));
}

/** Full catalog for the frontend (GET /metrics), in the same category→metric→field shape and order as analysis-ts's source /metrics response. */
export async function listMetricCatalog(): Promise<MetricCategory[]> {
  const prisma = getPrismaClient();
  const categories = await prisma.metricCategory.findMany({
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
      unit: metric.unit,
      formulaLatex: metric.formulaLatex,
      referenceUrl: metric.referenceUrl,
      academicSourceUrl: metric.academicSourceUrl,
      badge: metric.badge as unknown as MetricBadge | null,
      sources: metric.sources,
      sort: metric.position,
      // oingg-analysis-ts fills description/source/unit at the metric level only (the different period
      // variants of one metric — quarterly/TTM/etc — share the same definition/source/unit, so it
      // doesn't repeat itself per field). A field without its own falls back to its metric's, so the
      // frontend can always just read field.description/field.source/field.unit without knowing this
      // convention.
      fields: metric.fields.map((field) => ({
        key: field.key,
        name: field.name,
        period: field.period,
        description: field.description ?? metric.description,
        source: field.source ?? metric.source,
        unit: field.unit ?? metric.unit,
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
 * startup, see startMetricCatalogSync). MetricDefinitionField has `onDelete: Cascade` into
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
 *
 * Table names are `metric_category`/`metric_definition`/`metric_definition_field` (renamed 2026-09-11 from
 * `filter_category`/`filter_metric`/`filter_metric_field` via a hand-written ALTER TABLE RENAME migration —
 * see prisma/migrations/20260911040000_rename_filter_tables_to_metric — specifically NOT a Prisma-generated
 * drop+recreate, which would have cascade-deleted every user's ScreenerPresetFilter row).
 */
export async function replaceMetricCatalog(categories: MetricCategory[]): Promise<void> {
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
      unit: metric.unit ?? null,
      formulaLatex: metric.formulaLatex ?? null,
      referenceUrl: metric.referenceUrl ?? null,
      academicSourceUrl: metric.academicSourceUrl ?? null,
      badge: metric.badge ? JSON.stringify(metric.badge) : null,
      sources: metric.sources,
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
        unit: field.unit ?? null,
        position,
      })),
    ),
  );

  await prisma.$transaction(async (tx) => {
    if (categoryRows.length > 0) {
      await tx.$executeRaw`
        INSERT INTO metric_category (key, name, position)
        VALUES ${Prisma.join(categoryRows.map((c) => Prisma.sql`(${c.key}, ${c.name}, ${c.position})`))}
        ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position
      `;
    }

    if (metricRows.length > 0) {
      await tx.$executeRaw`
        INSERT INTO metric_definition (key, category_key, name, path, description, source, unit, formula_latex, reference_url, academic_source_url, badge, sources, position)
        VALUES ${Prisma.join(
          metricRows.map(
            (m) =>
              Prisma.sql`(${m.key}, ${m.categoryKey}, ${m.name}, ${m.path}, ${m.description}, ${m.source}, ${m.unit}, ${m.formulaLatex}, ${m.referenceUrl}, ${m.academicSourceUrl}, ${m.badge}::jsonb, ${m.sources}, ${m.position})`,
          ),
        )}
        ON CONFLICT (key) DO UPDATE SET
          category_key = EXCLUDED.category_key, name = EXCLUDED.name, path = EXCLUDED.path,
          description = EXCLUDED.description, source = EXCLUDED.source, unit = EXCLUDED.unit,
          formula_latex = EXCLUDED.formula_latex, reference_url = EXCLUDED.reference_url,
          academic_source_url = EXCLUDED.academic_source_url, badge = EXCLUDED.badge,
          sources = EXCLUDED.sources, position = EXCLUDED.position
      `;
    }

    if (fieldRows.length > 0) {
      await tx.$executeRaw`
        INSERT INTO metric_definition_field (metric_key, key, name, period, description, source, unit, position)
        VALUES ${Prisma.join(
          fieldRows.map(
            (f) =>
              Prisma.sql`(${f.metricKey}, ${f.key}, ${f.name}, ${f.period}, ${f.description}, ${f.source}, ${f.unit}, ${f.position})`,
          ),
        )}
        ON CONFLICT (metric_key, key) DO UPDATE SET
          name = EXCLUDED.name, period = EXCLUDED.period, description = EXCLUDED.description,
          source = EXCLUDED.source, unit = EXCLUDED.unit, position = EXCLUDED.position
      `;
    }

    // Deepest first: a field/metric/category genuinely dropped from the new catalog is deleted here
    // (cascading away any preset filter that pointed at it), rather than earlier as part of a blanket wipe.
    await tx.metricDefinitionField.deleteMany({
      where:
        fieldRows.length > 0
          ? { NOT: { OR: fieldRows.map((f) => ({ metricKey: f.metricKey, key: f.key })) } }
          : {},
    });
    await tx.metricDefinition.deleteMany({ where: { key: { notIn: metricRows.map((m) => m.key) } } });
    await tx.metricCategory.deleteMany({ where: { key: { notIn: categoryRows.map((c) => c.key) } } });
  });
}
