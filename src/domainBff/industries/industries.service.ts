import { fetchIndustryFlatList, fetchIndustryTree, fetchValueChainTree } from "@/domainBff/industries/industries.client.js";
import type { IndustryFlatList, IndustryTree, ValueChainTree } from "@/domainBff/industries/industries.types.js";

/** Node of the industry classification tree — GET /industries/tree. */
export async function getIndustryTree(code?: string): Promise<IndustryTree> {
  return fetchIndustryTree(code);
}

/** Full symbol -> classification-path listing, for building a search index client-side — GET /industries/flat. */
export async function getIndustryFlatList(): Promise<IndustryFlatList> {
  return fetchIndustryFlatList();
}

/** Node of TPEx's industry value-chain classification (separate system from getIndustryTree) — GET /industries/value-chain. */
export async function getValueChainTree(code?: string): Promise<ValueChainTree> {
  return fetchValueChainTree(code);
}
