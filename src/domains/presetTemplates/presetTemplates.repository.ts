import { getPrismaClient } from "@/adapters/neon/index.js";
import type { PresetTemplate as PresetTemplateRow } from "@/generated/prisma/client.js";
import type { PresetTemplate, PresetTemplateFilter } from "@/domains/presetTemplates/presetTemplates.types.js";

function toPresetTemplate(row: PresetTemplateRow): PresetTemplate {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    tier: row.tier,
    status: row.status,
    pendingReason: row.pendingReason,
    filters: row.filters as unknown as PresetTemplateFilter[],
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
