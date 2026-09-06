import { fetchIndustryTree } from "@/domainBff/industries/industries.client.js";
import type { IndustryTree } from "@/domainBff/industries/industries.types.js";

/** Node of the industry classification tree — GET /industries/tree. */
export async function getIndustryTree(code?: string): Promise<IndustryTree> {
  return fetchIndustryTree(code);
}
