import { fetchIndustryFlatList, fetchIndustryTree, fetchSecuritiesSectors } from "@/domainBff/industries/industries.client.js";
import type { IndustryFlatList, IndustryTree, SecuritiesSectorList } from "@/domainBff/industries/industries.types.js";

/** Node of the industry classification tree — GET /industries/tree. */
export async function getIndustryTree(code?: string): Promise<IndustryTree> {
  return fetchIndustryTree(code);
}

/** Full symbol -> classification-path listing, for building a search index client-side — GET /industries/flat. */
export async function getIndustryFlatList(): Promise<IndustryFlatList> {
  return fetchIndustryFlatList();
}

/** TWSE/TPEx securities-sector list (證交所類股), for the screener's sectorCodes filter — GET /industries/securities-sectors. */
export async function getSecuritiesSectors(): Promise<SecuritiesSectorList> {
  return fetchSecuritiesSectors();
}
