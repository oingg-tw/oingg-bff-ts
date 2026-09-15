import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { PeerGroupClassificationSource } from "@/domainBff/stock/peerGroup.types.js";
import type {
  ChainClassificationCompany,
  ChainClassificationGroup,
  ChainClassificationList,
  ChainCluster,
  ChainClusterMember,
  ChainClusterTree,
  ChainSubCluster,
  IndustryFlatCompany,
  IndustryFlatList,
  IndustryLevel,
  IndustryPathNode,
  IndustryTree,
  IndustryTreeChild,
  IndustryTreeCompany,
  SecuritiesSector,
  SecuritiesSectorList,
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

function normalizeSector(raw: unknown): SecuritiesSector {
  const r = raw as Record<string, unknown>;
  return { code: String(r.code), name: String(r.name), companyCount: Number(r.companyCount) };
}

/**
 * Fetches TWSE/TPEx's own securities-sector classification (證交所類股, e.g. "24" = 半導體業) from
 * analysis-ts's GET /industries/securities-sectors — a separate scheme from the gov-ts tax-registration
 * tree above, used to power the screener's sectorCodes filter.
 */
export async function fetchSecuritiesSectors(): Promise<SecuritiesSectorList> {
  const url = buildAnalysisServiceUrl("/industries/securities-sectors");
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Securities sectors endpoint");

  const body: unknown = await response.json();
  const sectors = (body as { sectors?: unknown } | null)?.sectors;
  if (!Array.isArray(sectors)) {
    logger.error({ url: url.toString() }, "Securities sectors endpoint response is missing a sectors array");
    throw new AppError("Securities sectors endpoint response is missing a sectors array", 502);
  }

  return { sectors: sectors.map(normalizeSector) };
}

function isPeerGroupClassificationSource(value: unknown): value is PeerGroupClassificationSource {
  return value === "keyword" || value === "gemini";
}

function normalizeChainClassificationCompany(raw: unknown): ChainClassificationCompany {
  const r = raw as Record<string, unknown>;
  return {
    symbol: String(r.symbol),
    companyName: String(r.companyName),
    category: typeof r.category === "string" ? r.category : null,
    coarseGroup: typeof r.coarseGroup === "string" ? r.coarseGroup : null,
    source: isPeerGroupClassificationSource(r.source) ? r.source : null,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

function normalizeChainClassificationGroup(raw: unknown): ChainClassificationGroup {
  const r = raw as Record<string, unknown>;
  return {
    coarseGroup: String(r.coarseGroup),
    fineCategories: Array.isArray(r.fineCategories) ? r.fineCategories.map(String) : [],
  };
}

/**
 * Fetches the full supply-chain-derived classification listing (companies + coarse-group/fine-category
 * rollup) from analysis-ts's GET /industries/chain-classification — added 2026-09-14 for web-nuxt's
 * "產業追蹤" page rebuild. Same underlying cache as GET /companies/peer-group (see peerGroup.client.ts),
 * NOT a replacement for GET /industries/tree/flat (the unrelated gov-ts tax-registration scheme), which
 * keep working unchanged. No query params — always the full ~1984-company listing; companies with
 * `category: null` are included, not filtered out.
 */
export async function fetchChainClassification(): Promise<ChainClassificationList> {
  const url = buildAnalysisServiceUrl("/industries/chain-classification");
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Chain classification endpoint");

  const body: unknown = await response.json();
  const b = body as { companies?: unknown; groups?: unknown };
  if (!Array.isArray(b.companies) || !Array.isArray(b.groups)) {
    logger.error({ url: url.toString() }, "Chain classification endpoint response is missing companies/groups arrays");
    throw new AppError("Chain classification endpoint response is missing companies/groups arrays", 502);
  }

  return {
    companies: b.companies.map(normalizeChainClassificationCompany),
    groups: b.groups.map(normalizeChainClassificationGroup),
  };
}

function normalizeChainClusterMember(raw: unknown): ChainClusterMember {
  const r = raw as Record<string, unknown>;
  return {
    code: String(r.code),
    name: String(r.name),
    isListed: r.isListed === true,
  };
}

function normalizeChainSubCluster(raw: unknown): ChainSubCluster {
  const r = raw as Record<string, unknown>;
  return {
    subClusterId: Number(r.subClusterId),
    subLabel: String(r.subLabel),
    members: Array.isArray(r.members) ? r.members.map(normalizeChainClusterMember) : [],
  };
}

function normalizeChainCluster(raw: unknown): ChainCluster {
  const r = raw as Record<string, unknown>;
  return {
    clusterId: Number(r.clusterId),
    label: String(r.label),
    metaGroup: typeof r.metaGroup === "string" ? r.metaGroup : null,
    directMembers: Array.isArray(r.directMembers) ? r.directMembers.map(normalizeChainClusterMember) : [],
    subClusters: Array.isArray(r.subClusters) ? r.subClusters.map(normalizeChainSubCluster) : [],
  };
}

/**
 * Fetches the full supply-chain cluster tree from analysis-ts's GET /industries/chain-clusters — added
 * 2026-09-14, an independent grouping concept from fetchChainClassification's flat category/coarseGroup
 * scheme (both served in parallel). `clusterId`/`subClusterId` are NOT stable across requests (see
 * industries.types.ts's ChainCluster/ChainSubCluster) — never persist them. No query params — always the
 * full tree (113 top-level clusters, 475 sub-clusters as of 2026-09-14).
 */
export async function fetchChainClusters(): Promise<ChainClusterTree> {
  const url = buildAnalysisServiceUrl("/industries/chain-clusters");
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Chain clusters endpoint");

  const body: unknown = await response.json();
  const clusters = (body as { clusters?: unknown } | null)?.clusters;
  if (!Array.isArray(clusters)) {
    logger.error({ url: url.toString() }, "Chain clusters endpoint response is missing a clusters array");
    throw new AppError("Chain clusters endpoint response is missing a clusters array", 502);
  }

  return { clusters: clusters.map(normalizeChainCluster) };
}
