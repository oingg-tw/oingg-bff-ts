import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  IndustryFlatCompany,
  IndustryFlatList,
  IndustryLevel,
  IndustryPathNode,
  IndustryTree,
  IndustryTreeChild,
  IndustryTreeCompany,
  SecuritiesSector,
  SecuritiesSectorList,
} from "@/application/proxy/industries/industries.types.js";
import type { IndustriesGatewayPort } from "@/application/ports/industriesGateway.js";

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

/**
 * IndustriesGatewayPort 的實作。上面的 fetchX 函式已經做完正規化與 502 判定，所以這裡只是把它們對應到
 * port 的方法名。
 *
 * 重構前中間還隔著一支 industries.service.ts，但那支檔案三個函式都是 `getX(a) => fetchX(a)`，沒有任何
 * 驗證或編排（`code` 的格式驗證一直在 route 的 zod schema，那份 schema 同時是 OpenAPI 的來源）。
 * 代理切片只要是純轉發，就不該為了湊滿分層而留一層空殼——跟 macro 切片同樣的判斷。
 */
export const analysisIndustriesGateway: IndustriesGatewayPort = {
  getIndustryTree: fetchIndustryTree,
  getIndustryFlatList: fetchIndustryFlatList,
  getSecuritiesSectors: fetchSecuritiesSectors,
};

