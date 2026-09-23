import { AppError } from "@/http/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { SecurityListEntry, SecurityListResult, SecurityType } from "@/domainBff/securities/securities.types.js";

const VALID_TYPES: SecurityType[] = ["COMMON", "PREFERRED", "ETF"];

function isSecurityType(value: unknown): value is SecurityType {
  return typeof value === "string" && (VALID_TYPES as string[]).includes(value);
}

function normalizeEntry(raw: unknown): SecurityListEntry {
  const r = raw as Record<string, unknown>;
  if (!isSecurityType(r.type)) {
    throw new AppError(`Securities list entry has an unrecognized type: ${String(r.type)}`, 502);
  }
  return { symbol: String(r.symbol), name: String(r.companyName), type: r.type };
}

function isSecurityListResponse(body: unknown): body is { count: unknown; limit: unknown; offset: unknown; entries: unknown[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { entries?: unknown }).entries);
}

/**
 * Fetches the unified search index (common stocks + TWSE preferred stocks + all ETFs, 2,716 entries as
 * of 2026-09-11) from analysis-ts's GET /securities — replaces web-nuxt's previous searchbar index, which
 * merged 3 separate bff-ts endpoints (GET /stocks + GET /stocks/preferred-stocks + POST /etf-screener)
 * client-side. Each entry's `type` (COMMON/PREFERRED/ETF, added by analysis-ts 2026-09-11) is what lets a
 * caller route a search result to the right detail page without guessing from the symbol's shape.
 *
 * analysis-ts paginates (limit 1-1000, default 200; offset default 0). bff-ts passes both straight
 * through rather than assembling the whole index in one call itself, same reasoning as companyList.client.ts's
 * fetchCompanyList.
 */
export async function fetchSecurityList(limit?: number, offset?: number): Promise<SecurityListResult> {
  const searchParams: Record<string, string> = {};
  if (limit !== undefined) {
    searchParams.limit = String(limit);
  }
  if (offset !== undefined) {
    searchParams.offset = String(offset);
  }

  const url = buildAnalysisServiceUrl("/securities", searchParams);
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Securities list endpoint");

  const body: unknown = await response.json();
  if (!isSecurityListResponse(body) || typeof body.count !== "number" || typeof body.limit !== "number" || typeof body.offset !== "number") {
    logger.error({ url: url.toString() }, "Securities list endpoint response is missing count/limit/offset/entries");
    throw new AppError("Securities list endpoint response is missing count/limit/offset/entries", 502);
  }

  return {
    count: body.count,
    limit: body.limit,
    offset: body.offset,
    entries: body.entries.map(normalizeEntry),
  };
}
