import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { PresetTemplate as PresetTemplateRow } from "@/generated/prisma/client.js";
import type { PresetTemplatesPort } from "@/application/ports/presetTemplates.js";
import type { PresetTemplate, PresetTemplateFilter } from "@/application/presetTemplates/presetTemplates.types.js";

function toPresetTemplate(row: PresetTemplateRow): PresetTemplate {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    description: row.description,
    status: row.status,
    pendingReason: row.pendingReason,
    filters: row.filters as unknown as PresetTemplateFilter[],
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPresetTemplates(): Promise<PresetTemplate[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.presetTemplate.findMany({ orderBy: { position: "asc" } });
  return rows.map(toPresetTemplate);
}

export async function findPresetTemplate(id: string): Promise<PresetTemplate | null> {
  const prisma = getPrismaClient();
  const row = await prisma.presetTemplate.findUnique({ where: { id } });
  return row ? toPresetTemplate(row) : null;
}

/**
 * PresetTemplatesPort 的 Prisma 實作。
 *
 * 這裡沒有 P2002 之類的翻譯要做，因為這個 port 是唯讀的；它存在的理由單純是別讓 use case 直接認得
 * Prisma。另外注意 `filters` 欄位在 DB 是 jsonb，toPresetTemplate 把它當成 PresetTemplateFilter[]
 * 斷言回來——JSON 欄位沒有型別保證，這個斷言是種子腳本負責維持的，也是它只該留在這一層的原因。
 */
export const prismaPresetTemplates: PresetTemplatesPort = {
  list: listPresetTemplates,
  find: findPresetTemplate,
};
