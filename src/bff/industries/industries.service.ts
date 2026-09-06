import { fetchIndustryTree } from "@/bff/industries/industries.client.js";
import type { IndustryTree } from "@/bff/industries/industries.types.js";

/** Node of the industry classification tree — GET /industries/tree. */
export async function getIndustryTree(code?: string): Promise<IndustryTree> {
  return fetchIndustryTree(code);
}
