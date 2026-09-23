import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { PresetTemplate as PresetTemplateRow } from "@/generated/prisma/client.js";
import type { PresetTemplate, PresetTemplateFilter } from "@/application/presetTemplates/presetTemplates.types.js";

function toPresetTemplate(row: PresetTemplateRow): PresetTemplate {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    description: row.description,
    tier: row.tier,
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
