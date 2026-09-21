import { fetchCbcPolicyRate } from "@/domainBff/macro/macro.client.js";
import type { CbcPolicyRateResult } from "@/domainBff/macro/macro.types.js";

/** CBC policy-rate adjustment events, oldest to newest — GET /macro/cbc-policy-rate. */
export async function getCbcPolicyRate(from?: string): Promise<CbcPolicyRateResult> {
  return fetchCbcPolicyRate(from);
}
