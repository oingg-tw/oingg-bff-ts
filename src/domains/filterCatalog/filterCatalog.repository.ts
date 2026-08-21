import { getNeonPool } from "../../adapters/neon/index.js";
import type { FilterCategory } from "./filterCatalog.types.js";

/** oingg-bff-ts's own database (NEON_DB_APP_URL) — this service owns this schema. */
const APP_DB = "app";

export async function ensureFilterCatalogSchema(): Promise<void> {
  const pool = getNeonPool(APP_DB);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS filter_category (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS filter_metric (
      key TEXT PRIMARY KEY,
      category_key TEXT NOT NULL REFERENCES filter_category(key) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS filter_metric_field (
      metric_key TEXT NOT NULL REFERENCES filter_metric(key) ON DELETE CASCADE,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      period TEXT NOT NULL,
      PRIMARY KEY (metric_key, key)
    );
  `);
}

/** Wipes and rewrites the whole catalog in one transaction — it's a small, fully-replaced snapshot, not incrementally updated data. */
export async function replaceFilterCatalog(categories: FilterCategory[]): Promise<void> {
  const pool = getNeonPool(APP_DB);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM filter_category");

    for (const category of categories) {
      await client.query("INSERT INTO filter_category (key, name) VALUES ($1, $2)", [
        category.key,
        category.name,
      ]);

      for (const metric of category.metrics) {
        await client.query(
          "INSERT INTO filter_metric (key, category_key, name, path) VALUES ($1, $2, $3, $4)",
          [metric.key, category.key, metric.name, metric.path],
        );

        for (const field of metric.fields) {
          await client.query(
            "INSERT INTO filter_metric_field (metric_key, key, name, period) VALUES ($1, $2, $3, $4)",
            [metric.key, field.key, field.name, field.period],
          );
        }
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
