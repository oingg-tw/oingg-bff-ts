import { fetchCompanies } from "./companies.client.js";

/**
 * Company names are analysis-ts's market/reference data, not bff-ts's own — unlike filterCatalog or
 * columnPresetTemplates (product/config data this service is meant to own a copy of), this is never
 * persisted into our own DB or kept in a module-level cache across requests. Each call live-fetches
 * analysis-ts's full company list and immediately discards everything except the symbols asked for; no
 * state survives past the single request that triggered it.
 *
 * Trade-off: this refetches all ~1,400 companies from analysis-ts on every screener call, even though
 * analysis-ts described the data as low-frequency-changing and suggested caching it — a deliberate
 * choice to hold zero copy of market data over minimizing request volume.
 */
export async function getCompanyNames(symbols: string[]): Promise<Map<string, string | null>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const wanted = new Set(symbols);
  const companies = await fetchCompanies();
  const namesBySymbol = new Map<string, string | null>();
  for (const company of companies) {
    if (wanted.has(company.companyId)) {
      namesBySymbol.set(company.companyId, company.companyName);
    }
  }
  return namesBySymbol;
}
