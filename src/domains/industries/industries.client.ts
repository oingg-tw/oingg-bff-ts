import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { IndustryLevel, IndustryTree, IndustryTreeChild, IndustryTreeCompany } from "@/domains/industries/industries.types.js";

const VALID_LEVELS: IndustryLevel[] = ["section", "division", "group", "class", "subclass"];

function isIndustryLevel(value: unknown): value is IndustryLevel {
  return typeof value === "string" && VALID_LEVELS.includes(value as IndustryLevel);
}

function normalizeLevel(value: unknown): IndustryLevel | null {
  return isIndustryLevel(value) ? value : null;
}

function normalizeChild(raw: unknown): IndustryTreeChild {
  const r = raw as Record<string, unknown>;
  if (!isIndustryLevel(r.level)) {
    throw new AppError(`Industry tree child has an unrecognized level: ${String(r.level)}`, 502);
  }
  return {
    code: String(r.code),
    level: r.level,
    name: String(r.name),
    companyCount: Number(r.companyCount),
    hasChildren: r.hasChildren === true,
  };
}

function normalizeCompany(raw: unknown): IndustryTreeCompany {
  const r = raw as Record<string, unknown>;
  return { symbol: String(r.symbol), companyName: String(r.companyName) };
}

/**
 * Fetches a node of gov-ts's 5-level tax-registration industry classification tree (section → division
 * → group → class → subclass) from analysis-ts's GET /industries/tree?code=. Omitting `code` returns the
 * root (19 top-level sections). `code` is globally unique across all 5 levels — the server resolves
 * which level it belongs to, no separate level parameter needed.
 */
export async function fetchIndustryTree(code?: string): Promise<IndustryTree> {
  const url = buildAnalysisServiceUrl("/industries/tree", code !== undefined ? { code } : undefined);
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Industry tree endpoint");

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || typeof (body as { found?: unknown }).found !== "boolean") {
    logger.error({ url: url.toString() }, "Industry tree endpoint response is missing a boolean found field");
    throw new AppError("Industry tree endpoint response is missing a boolean found field", 502);
  }

  const r = body as Record<string, unknown>;
  return {
    found: r.found as boolean,
    code: r.code === null || r.code === undefined ? null : String(r.code),
    level: normalizeLevel(r.level),
    name: r.name === null || r.name === undefined ? null : String(r.name),
    companyCount: Number(r.companyCount ?? 0),
    children: Array.isArray(r.children) ? r.children.map(normalizeChild) : [],
    companies: Array.isArray(r.companies) ? r.companies.map(normalizeCompany) : [],
  };
}
