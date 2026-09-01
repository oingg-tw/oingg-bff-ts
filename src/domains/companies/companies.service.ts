import { fetchCompanies } from "./companies.client.js";
import { findCompanyNames, getCompaniesSyncedAt, replaceCompanies } from "./companies.repository.js";

const FRESHNESS_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 30_000;
// A restart-only check would leave a long-running process stuck on a stale cache forever once past the
// 24h window — this periodic check makes that self-heal without a restart. Cheap: one DB read except on
// the day a real re-sync is actually due.
const RECHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface CompanySyncSummary {
  companyCount: number;
}

/** Looks up display names for a batch of symbols from our own cache — see findCompanyNames for why this is one query, not N. */
export async function getCompanyNames(symbols: string[]): Promise<Map<string, string | null>> {
  return findCompanyNames(symbols);
}

/** Fetches the company name reference table from analysis-ts and stores it in the BFF's own database. */
export async function syncCompanies(): Promise<CompanySyncSummary> {
  const companies = await fetchCompanies();
  await replaceCompanies(companies);

  console.log(`Synced companies: ${companies.length} companies`);
  return { companyCount: companies.length };
}

/**
 * Skips re-fetching from analysis-ts if the cache was synced within the last 24 hours — this is a
 * deliberate exception to bff-ts's usual "never cache analysis-ts's market data" rule, specifically for
 * company names: looked up on every screener row (high read:write ratio) and a day-stale name is fine
 * (unlike screener metric values, where staleness would show paid users a wrong ranking). Persisted via
 * CompanySyncState so the skip holds across restarts too, not just within one process's lifetime.
 */
export async function syncCompaniesIfStale(): Promise<CompanySyncSummary | null> {
  const syncedAt = await getCompaniesSyncedAt();
  if (syncedAt && Date.now() - syncedAt.getTime() < FRESHNESS_MS) {
    return null;
  }
  return syncCompanies();
}

/**
 * Fire-and-forget sync with a single retry at startup, then a periodic re-check for the lifetime of the
 * process — same mechanism/rationale as filterCatalog's startFilterCatalogSync, plus the periodic part
 * (see RECHECK_INTERVAL_MS) since this cache's freshness window is much shorter than "until next
 * restart". `.unref()` so the interval never blocks graceful shutdown.
 */
export function startCompanySync(retriesLeft = 1): void {
  syncCompaniesIfStale().catch((error: unknown) => {
    if (retriesLeft > 0) {
      console.warn(`Company sync failed, keeping existing data and retrying in ${RETRY_DELAY_MS / 1000}s:`, error);
      setTimeout(() => startCompanySync(retriesLeft - 1), RETRY_DELAY_MS);
    } else {
      console.error("Company sync failed again, giving up until the next restart or recheck:", error);
    }
  });

  setInterval(() => {
    syncCompaniesIfStale().catch((error: unknown) => console.error("Periodic company re-sync failed:", error));
  }, RECHECK_INTERVAL_MS).unref();
}
