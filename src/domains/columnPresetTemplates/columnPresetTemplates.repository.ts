import { getPrismaClient } from "../../adapters/neon/index.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { ColumnPresetTemplate as ColumnPresetTemplateRow } from "../../generated/prisma/client.js";
import type { ColumnPresetTemplate } from "./columnPresetTemplates.types.js";

function toView(row: ColumnPresetTemplateRow): ColumnPresetTemplate {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    fieldKeys: row.fieldKeys as unknown as string[],
  };
}

export async function listColumnPresetTemplates(): Promise<ColumnPresetTemplate[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.columnPresetTemplate.findMany({ orderBy: { position: "asc" } });
  return rows.map(toView);
}

export async function findColumnPresetTemplate(key: string): Promise<ColumnPresetTemplate | null> {
  const prisma = getPrismaClient();
  const row = await prisma.columnPresetTemplate.findUnique({ where: { key } });
  return row ? toView(row) : null;
}

/**
 * Upserts by natural key (`key`) and deletes only rows genuinely absent from the new list — not a
 * delete-everything-then-recreate (see filterCatalog.repository.ts's replaceFilterCatalog for why that
 * pattern is banned here: nothing FKs into this table today, but a future feature might, and getting the
 * habit right now costs nothing).
 */
export async function replaceColumnPresetTemplates(templates: ColumnPresetTemplate[]): Promise<void> {
  const prisma = getPrismaClient();

  const rows = templates.map((template, position) => ({
    key: template.key,
    name: template.name,
    description: template.description,
    fieldKeys: JSON.stringify(template.fieldKeys),
    position,
  }));

  await prisma.$transaction(async (tx) => {
    if (rows.length > 0) {
      await tx.$executeRaw`
        INSERT INTO column_preset_template (key, name, description, field_keys, position)
        VALUES ${Prisma.join(
          rows.map((r) => Prisma.sql`(${r.key}, ${r.name}, ${r.description}, ${r.fieldKeys}::jsonb, ${r.position})`),
        )}
        ON CONFLICT (key) DO UPDATE SET
          name = EXCLUDED.name, description = EXCLUDED.description, field_keys = EXCLUDED.field_keys,
          position = EXCLUDED.position
      `;
    }
    await tx.columnPresetTemplate.deleteMany({ where: { key: { notIn: rows.map((r) => r.key) } } });
  });
}
