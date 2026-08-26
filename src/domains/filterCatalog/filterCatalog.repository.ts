import { getPrismaClient } from "../../adapters/neon/index.js";
import type { FilterCategory } from "./filterCatalog.types.js";

export interface FilterFieldLookup {
  categoryKey: string;
  metricKey: string;
  metricName: string;
  fieldKey: string;
  fieldName: string;
  period: string;
}

/** Looks up a single catalog field by (metricKey, fieldKey) — used to validate screener filters/columns. */
export async function findFilterField(metricKey: string, fieldKey: string): Promise<FilterFieldLookup | null> {
  const prisma = getPrismaClient();
  const field = await prisma.filterMetricField.findFirst({
    where: { metricKey, key: fieldKey },
    include: { metric: true },
  });

  if (!field) {
    return null;
  }

  return {
    categoryKey: field.metric.categoryKey,
    metricKey: field.metric.key,
    metricName: field.metric.name,
    fieldKey: field.key,
    fieldName: field.name,
    period: field.period,
  };
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
    metrics: category.metrics.map((metric) => ({
      key: metric.key,
      name: metric.name,
      path: metric.path,
      fields: metric.fields.map((field) => ({ key: field.key, name: field.name, period: field.period })),
    })),
  }));
}

/**
 * Wipes and rewrites the whole catalog in one transaction — it's a small, fully-replaced snapshot,
 * not incrementally updated data.
 *
 * Uses createMany per table (not one create() per row) so this stays at 4 queries regardless of
 * catalog size — looping individual create()s here once blew past Prisma's 5s interactive-transaction
 * timeout against a real (non-localhost) Neon connection once the catalog grew past a couple categories.
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
        position,
      })),
    ),
  );

  await prisma.$transaction(async (tx) => {
    await tx.filterCategory.deleteMany();
    await tx.filterCategory.createMany({ data: categoryRows });
    await tx.filterMetric.createMany({ data: metricRows });
    await tx.filterMetricField.createMany({ data: fieldRows });
  });
}
