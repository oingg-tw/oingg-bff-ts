/**
 * Seeds PresetTemplate. Previously held 21 templates derived from a competitor-research report
 * (oingg-conductor-ts/docs/compass_artifact_wf-3e795a7d-..., 2026-08-30) — confirmed by the user
 * 2026-09-08 to have all been placeholder/demo seed data, not a real requested feature, and removed
 * (including the live DB rows, deleted separately from this file). Real templates will be defined here
 * again once a product decision on this feature exists.
 *
 * Idempotent: upserts by `name` (unique), safe to re-run after editing. Note this only upserts what's
 * listed below — it does NOT delete rows removed from this array (see feedback_no_destructive_syncs);
 * removing a template here requires a separate explicit delete against the live DB.
 *
 * Run with: pnpm run seed:preset-templates
 */
import "dotenv/config";
import { getPrismaClient, closePrismaClient } from "../src/adapters/neon/prismaClient.js";
import type { PresetTemplateFilter } from "../src/domainBusiness/presetTemplates/presetTemplates.types.js";

interface TemplateSeed {
  name: string;
  category: string;
  description: string;
  tier: "FREE" | "PAID";
  status: "AVAILABLE" | "PENDING";
  pendingReason: string | null;
  filters: PresetTemplateFilter[];
}

const TEMPLATES: TemplateSeed[] = [];

async function main() {
  const prisma = getPrismaClient();

  for (const [index, template] of TEMPLATES.entries()) {
    await prisma.presetTemplate.upsert({
      where: { name: template.name },
      create: { ...template, position: index },
      update: { ...template, position: index },
    });
  }

  console.log(`Seeded ${TEMPLATES.length} preset templates.`);
  const available = TEMPLATES.filter((t) => t.status === "AVAILABLE").length;
  console.log(`  ${available} AVAILABLE, ${TEMPLATES.length - available} PENDING.`);
}

main()
  .catch((error: unknown) => {
    console.error("Seeding preset templates failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePrismaClient();
  });
