import { getPrismaClient } from "../../adapters/neon/index.js";
import type { FilterCategory } from "./filterCatalog.types.js";

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

  const categoryRows = categories.map((category) => ({ key: category.key, name: category.name }));

  const metricRows = categories.flatMap((category) =>
    category.metrics.map((metric) => ({
      key: metric.key,
      categoryKey: category.key,
      name: metric.name,
      path: metric.path,
    })),
  );

  const fieldRows = categories.flatMap((category) =>
    category.metrics.flatMap((metric) =>
      metric.fields.map((field) => ({
        metricKey: metric.key,
        key: field.key,
        name: field.name,
        period: field.period,
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
