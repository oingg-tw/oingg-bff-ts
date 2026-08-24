import { getPrismaClient } from "../../adapters/neon/index.js";
import type { FilterCategory } from "./filterCatalog.types.js";

/** Wipes and rewrites the whole catalog in one transaction — it's a small, fully-replaced snapshot, not incrementally updated data. */
export async function replaceFilterCatalog(categories: FilterCategory[]): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    await tx.filterCategory.deleteMany();

    for (const category of categories) {
      await tx.filterCategory.create({ data: { key: category.key, name: category.name } });

      for (const metric of category.metrics) {
        await tx.filterMetric.create({
          data: { key: metric.key, categoryKey: category.key, name: metric.name, path: metric.path },
        });

        for (const field of metric.fields) {
          await tx.filterMetricField.create({
            data: { metricKey: metric.key, key: field.key, name: field.name, period: field.period },
          });
        }
      }
    }
  });
}
