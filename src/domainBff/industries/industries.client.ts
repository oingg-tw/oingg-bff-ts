import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  IndustryFlatCompany,
  IndustryFlatList,
  IndustryLevel,
  IndustryPathNode,
  IndustryTree,
  IndustryTreeChild,
  IndustryTreeCompany,
  ValueChainMarket,
  ValueChainTree,
  ValueChainTreeChild,
  ValueChainTreeCompany,
} from "@/domainBff/industries/industries.types.js";

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

function normalizePathNode(raw: unknown): IndustryPathNode {
  const r = raw as Record<string, unknown>;
  if (!isIndustryLevel(r.level)) {
    throw new AppError(`Industry flat list path node has an unrecognized level: ${String(r.level)}`, 502);
  }
  return { code: String(r.code), level: r.level, name: String(r.name) };
}

function normalizeFlatCompany(raw: unknown): IndustryFlatCompany {
  const r = raw as Record<string, unknown>;
  return {
    symbol: String(r.symbol),
    companyName: String(r.companyName),
    path: Array.isArray(r.path) ? r.path.map(normalizePathNode) : [],
  };
}

/**
 * Fetches the full symbol -> classification-path listing for all gov-ts-tracked companies from
 * analysis-ts's GET /industries/flat — added 2026-09-09 so a caller building a symbol/keyword search index
 * doesn't have to recursively crawl GET /industries/tree. No query params; reads their in-memory cache, no
 * extra DB query on their side.
 */
export async function fetchIndustryFlatList(): Promise<IndustryFlatList> {
  const url = buildAnalysisServiceUrl("/industries/flat");
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Industry flat list endpoint");

  const body: unknown = await response.json();
  const companies = (body as { companies?: unknown } | null)?.companies;
  if (!Array.isArray(companies)) {
    logger.error({ url: url.toString() }, "Industry flat list endpoint response is missing a companies array");
    throw new AppError("Industry flat list endpoint response is missing a companies array", 502);
  }

  return { companies: companies.map(normalizeFlatCompany) };
}

const VALID_VALUE_CHAIN_LEVELS = ["industry", "subChain"];
const VALID_MARKETS = ["listed", "otc", "rotc"];

function isValueChainLevel(value: unknown): value is "industry" | "subChain" {
  return typeof value === "string" && VALID_VALUE_CHAIN_LEVELS.includes(value);
}

function isValueChainMarket(value: unknown): value is ValueChainMarket {
  return typeof value === "string" && VALID_MARKETS.includes(value);
}

function normalizeValueChainChild(raw: unknown): ValueChainTreeChild {
  const r = raw as Record<string, unknown>;
  return { code: String(r.code), name: String(r.name), companyCount: Number(r.companyCount) };
}

function normalizeValueChainCompany(raw: unknown): ValueChainTreeCompany {
  const r = raw as Record<string, unknown>;
  if (!isValueChainMarket(r.market)) {
    throw new AppError(`Industry value-chain company has an unrecognized market: ${String(r.market)}`, 502);
  }
  return { symbol: String(r.symbol), companyName: String(r.companyName), market: r.market };
}

/**
 * Fetches a node of TPEx's 產業價值鏈 (industry value-chain) classification from analysis-ts's
 * GET /industries/value-chain?code= — a completely separate system from fetchIndustryTree's gov-ts
 * tax-registration tree (see ValueChainTree's docstring for the differences: 2 levels not 5, many-to-many
 * not single-classification, all 3 market tiers not TWSE-only). Omitting `code` returns the root (47
 * top-level industries). `code` is globally unique across both levels, same as the tax-registration tree.
 */
export async function fetchValueChainTree(code?: string): Promise<ValueChainTree> {
  const url = buildAnalysisServiceUrl("/industries/value-chain", code !== undefined ? { code } : undefined);
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Industry value-chain endpoint");

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || typeof (body as { found?: unknown }).found !== "boolean") {
    logger.error({ url: url.toString() }, "Industry value-chain endpoint response is missing a boolean found field");
    throw new AppError("Industry value-chain endpoint response is missing a boolean found field", 502);
  }

  const r = body as Record<string, unknown>;
  const level = isValueChainLevel(r.level) ? r.level : null;
  return {
    found: r.found as boolean,
    code: r.code === null || r.code === undefined ? null : String(r.code),
    level,
    name: r.name === null || r.name === undefined ? null : String(r.name),
    children: Array.isArray(r.children) ? r.children.map(normalizeValueChainChild) : [],
    companies: Array.isArray(r.companies) ? r.companies.map(normalizeValueChainCompany) : [],
    dataSource: String(r.dataSource ?? ""),
  };
}
