import { fetchSecurityList } from "@/domainBff/securities/securities.client.js";
import type { SecurityListResult } from "@/domainBff/securities/securities.types.js";

/** Unified search index (common stocks + preferred stocks + ETFs) — GET /securities. */
export async function getSecurityList(limit?: number, offset?: number): Promise<SecurityListResult> {
  return fetchSecurityList(limit, offset);
}
