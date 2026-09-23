import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import { Prisma } from "@/generated/prisma/client.js";
import type { ColumnPresetTemplate as ColumnPresetTemplateRow } from "@/generated/prisma/client.js";
import type { ColumnPresetTemplatesPort } from "@/application/ports/columnPresetTemplates.js";
import type { ColumnPresetTemplate } from "@/application/columnPresetTemplates/columnPresetTemplates.types.js";

function toView(row: ColumnPresetTemplateRow): ColumnPresetTemplate {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    fieldKeys: row.fieldKeys as unknown as string[],
    isDefault: row.isDefault,
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
 * The neutral "overview" template (see ColumnPresetTemplate.isDefault) — used by
 * columnPresets.service.ts's resolveScreenerColumns as the screener's own default column set, the
 * curated replacement for the hardcoded SYSTEM_DEFAULT_COLUMNS array that used to live there. Returns
 * null if the seed hasn't run yet, in which case the caller falls back to no columns rather than crashing.
 */
export async function findDefaultColumnPresetTemplate(): Promise<ColumnPresetTemplate | null> {
  const prisma = getPrismaClient();
  const row = await prisma.columnPresetTemplate.findFirst({ where: { isDefault: true } });
  return row ? toView(row) : null;
}

/**
 * Upserts by natural key (`key`) and deletes only rows genuinely absent from the new list — not a
 * delete-everything-then-recreate (see metricCatalog.repository.ts's replaceMetricCatalog for why that
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
    isDefault: template.isDefault,
    position,
  }));

  await prisma.$transaction(async (tx) => {
    if (rows.length > 0) {
      await tx.$executeRaw`
        INSERT INTO column_preset_template (key, name, description, field_keys, is_default, position)
        VALUES ${Prisma.join(
          rows.map(
            (r) =>
              Prisma.sql`(${r.key}, ${r.name}, ${r.description}, ${r.fieldKeys}::jsonb, ${r.isDefault}, ${r.position})`,
          ),
        )}
        ON CONFLICT (key) DO UPDATE SET
          name = EXCLUDED.name, description = EXCLUDED.description, field_keys = EXCLUDED.field_keys,
          is_default = EXCLUDED.is_default, position = EXCLUDED.position
      `;
    }
    await tx.columnPresetTemplate.deleteMany({ where: { key: { notIn: rows.map((r) => r.key) } } });
  });
}

/**
 * ColumnPresetTemplatesPort 的 Prisma 實作——唯讀，理由同 prismaPresetTemplates。
 *
 * replaceColumnPresetTemplates 刻意不在 port 上：它只有種子腳本（prisma/seedColumnPresetTemplates.ts）
 * 用得到，而種子腳本是獨立的一次性程式，不是 use case。為了它在 port 開一個 API 永遠不會呼叫的寫入
 * 方法，只會讓每個拿到 AppDeps 的人型別上都摸得到「整批覆寫策展範本」。
 */
export const prismaColumnPresetTemplates: ColumnPresetTemplatesPort = {
  list: listColumnPresetTemplates,
  find: findColumnPresetTemplate,
  findDefault: findDefaultColumnPresetTemplate,
};
