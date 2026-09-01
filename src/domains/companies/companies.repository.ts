import { getPrismaClient } from "../../adapters/neon/index.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { Company } from "./companies.types.js";

const SYNC_STATE_ID = 1;

/**
 * Batched company-name lookup against our own cache — a screener page can return up to a pageSize's
 * worth of symbols at once, so this is one query for the whole page rather than one round trip per row
 * (same reasoning as findFilterFields in filterCatalog.repository.ts). Symbols with no cached row (not
 * yet synced, or genuinely unknown to analysis-ts) are simply absent from the returned Map — callers
 * treat "missing" the same as "companyName: null".
 */
export async function findCompanyNames(companyIds: string[]): Promise<Map<string, string | null>> {
  if (companyIds.length === 0) {
    return new Map();
  }

  const prisma = getPrismaClient();
  const rows = await prisma.company.findMany({ where: { companyId: { in: companyIds } } });
  return new Map(rows.map((row) => [row.companyId, row.companyName]));
}

export async function getCompaniesSyncedAt(): Promise<Date | null> {
  const prisma = getPrismaClient();
  const state = await prisma.companySyncState.findUnique({ where: { id: SYNC_STATE_ID } });
  return state?.syncedAt ?? null;
}

/**
 * Upserts by natural key (`companyId`), deletes only rows genuinely absent from the new list (same
 * "no destructive syncs" rationale as replaceFilterCatalog/replaceColumnPresetTemplates), and stamps
 * CompanySyncState in the same transaction — a crash between replacing the rows and recording "when"
 * must never leave a stale timestamp paired with fresh data (or vice versa).
 */
export async function replaceCompanies(companies: Company[]): Promise<void> {
  const prisma = getPrismaClient();

  // Regression: analysis-ts's GET /companies has been observed live with a couple of exact-duplicate
  // companyId entries (same id, same name) — a single `INSERT ... ON CONFLICT DO UPDATE` statement
  // can't touch the same row twice ("ON CONFLICT DO UPDATE command cannot affect row a second time",
  // a hard Postgres error, not something ON CONFLICT can swallow). Dedupe by companyId before building
  // the statement rather than trusting the upstream list is already unique.
  const uniqueCompanies = [...new Map(companies.map((c) => [c.companyId, c])).values()];

  await prisma.$transaction(async (tx) => {
    if (uniqueCompanies.length > 0) {
      await tx.$executeRaw`
        INSERT INTO company (company_id, company_name)
        VALUES ${Prisma.join(uniqueCompanies.map((c) => Prisma.sql`(${c.companyId}, ${c.companyName})`))}
        ON CONFLICT (company_id) DO UPDATE SET company_name = EXCLUDED.company_name
      `;
    }
    await tx.company.deleteMany({ where: { companyId: { notIn: uniqueCompanies.map((c) => c.companyId) } } });
    await tx.companySyncState.upsert({
      where: { id: SYNC_STATE_ID },
      create: { id: SYNC_STATE_ID, syncedAt: new Date() },
      update: { syncedAt: new Date() },
    });
  });
}
