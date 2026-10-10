import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService, passThroughEnum, renamedField } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { CompanyProfile } from "@/application/proxy/stock/companyProfile.types.js";
import type { Market } from "@/application/proxy/market/market.types.js";

/** Same convention as stockQuote.client.ts's toStringOrNull — see that file for why. */
function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}


/**
 * `market` 會收斂成 `"TWSE" | "TPEx"`，而**未知值會落到 TWSE**——所以這裡要出聲。2026-10-01 的實例：
 * tpex-ts 指出上游的 `company_profile` 用 `source` 區分興櫃（COMPANY_PROFILE_EMERGING，365 家），
 * 並建議把 `market` 分出一個 `EMERGING`。如果上游真的那樣做而這裡沒跟上，**興櫃會被靜默標成「上市」**
 * ——一個錯的標籤比缺一個標籤糟，而且從 payload 看不出來。
 *
 * 不丟 502（對比 metricDataType）：market 是一個標籤、不是整列意義的前提，上游多一種市場別不該讓個股頁
 * 整頁掛掉。跟 exDividendCalendar 的 securityType 同一個判準（2026-09-30）。
 *
 * **同樣的寫法在 marketRankings.client.ts 的 normalizeMarket 也有一份**（排行榜的每一列）。兩處刻意不抽成
 * 共用函式：抽去哪裡都要把 Market 這個領域型別拉進通用的出向 client，而兩份加上互相指名的註解比那個耦合便宜。
 * 真的出現第三處再抽。
 */
function normalizeProfileMarket(value: unknown, symbol: string): Market {
  // 未知的字串照樣放行（2026-10-08，passThroughEnum）：以前改寫成 TWSE，等於把新的市場別悄悄標成上市。
  // 缺欄位才沿用舊行為落到 TWSE 並記 warn。
  const market = passThroughEnum(value, KNOWN_MARKETS, { field: "market", symbol });
  if (market !== null) {
    return market;
  }
  logger.warn({ symbol, market: value }, "Company profile is missing its market — defaulting to TWSE");
  return "TWSE";
}

const KNOWN_MARKETS: readonly Market[] = ["TWSE", "TPEx"];

/**
 * 交易所「編製財務報告類型」跟 MOPS dataType 對合併／個別的編號相反：交易所 "1" 合併 = MOPS "2" 合併。
 * 未知代碼回 null，不猜。
 */
function flipDataTypeEncoding(code: string | null): string | null {
  return code === "1" ? "2" : code === "2" ? "1" : null;
}

/**
 * 並存期舊名（2026-10-10 起，跟著 analysis-ts 批次 2b；web-nuxt 改完就刪這個型別、withLegacyProfileKeys 與它的呼叫）。
 *
 * 不放進 legacyResponseKeys.ts 那張通用表：sectorCode 的舊名在這裡是 industry，在類股字典是 code；而
 * financialReportType 不是別名而是**舊編碼**，並存期的意思是舊欄位讀起來跟以前一樣。唯一變好的是 industryName：
 * 以前上櫃一律 null，現在跟 sectorName 一樣有值。
 */
interface LegacyCompanyProfileKeys {
  reportDate: string | null;
  industry: string | null;
  industryName: string | null;
  listedDate: string | null;
  preferredStockShares: string | null;
  financialReportType: string | null;
}

function withLegacyProfileKeys(profile: CompanyProfile): CompanyProfile & LegacyCompanyProfileKeys {
  return {
    ...profile,
    reportDate: profile.generatedDate,
    industry: profile.sectorCode,
    industryName: profile.sectorName,
    listedDate: profile.listingDate,
    preferredStockShares: profile.numberOfPreferenceShares,
    financialReportType: flipDataTypeEncoding(profile.declaredDataType),
  };
}

function normalizeCompanyProfile(raw: Record<string, unknown>): CompanyProfile {
  const metricDataType = passThroughEnum(raw.metricDataType, ["1", "2"] as const, { field: "metricDataType", symbol: raw.symbol });
  if (metricDataType === null) {
    throw new AppError(`Company profile for "${String(raw.symbol)}" is missing metricDataType`, 502);
  }
  // 批次 2b 的新名優先、舊名後備：舊名 2026-10-24 才從上游消失，而部署的 analysis-ts 不一定已經有新名
  // （本機跟部署是兩個上游）。上游舊名移除、DEV 也部署之後，把這些「?? 舊名」與舊編碼的翻轉一起刪掉。
  return {
    symbol: String(raw.symbol),
    metricDataType,
    market: normalizeProfileMarket(raw.market, String(raw.symbol)),
    // 缺席給 null 不給 false——理由見 companyProfile.types.ts。上游 PRD 還沒有這個欄位，而把興櫃說成
    // 「不是興櫃」是錯的標籤；null 讓呼叫端知道「還不知道」。
    isEmerging: typeof raw.isEmerging === "boolean" ? raw.isEmerging : null,
    generatedDate: toStringOrNull(renamedField(raw, "generatedDate", "reportDate")),
    name: toStringOrNull(raw.name),
    shortName: toStringOrNull(raw.shortName),
    foreignRegistrationCountry: toStringOrNull(raw.foreignRegistrationCountry),
    sectorCode: toStringOrNull(renamedField(raw, "sectorCode", "industry")),
    sectorName: toStringOrNull(renamedField(raw, "sectorName", "industryName")),
    address: toStringOrNull(raw.address),
    taxId: toStringOrNull(raw.taxId),
    chairman: toStringOrNull(raw.chairman),
    generalManager: toStringOrNull(raw.generalManager),
    spokesperson: toStringOrNull(raw.spokesperson),
    spokespersonTitle: toStringOrNull(raw.spokespersonTitle),
    deputySpokesperson: toStringOrNull(raw.deputySpokesperson),
    phone: toStringOrNull(raw.phone),
    establishedDate: toStringOrNull(raw.establishedDate),
    listingDate: toStringOrNull(renamedField(raw, "listingDate", "listedDate")),
    parValue: toStringOrNull(raw.parValue),
    paidInCapital: toStringOrNull(raw.paidInCapital),
    privatePlacementShares: toStringOrNull(raw.privatePlacementShares),
    numberOfPreferenceShares: toStringOrNull(renamedField(raw, "numberOfPreferenceShares", "preferredStockShares")),
    // 舊欄位是交易所編碼，要翻過來，不能直接當新值用。
    declaredDataType: "declaredDataType" in raw ? toStringOrNull(raw.declaredDataType) : flipDataTypeEncoding(toStringOrNull(raw.financialReportType)),
    financialReportTypeName: toStringOrNull(raw.financialReportTypeName),
    stockTransferAgency: toStringOrNull(raw.stockTransferAgency),
    transferAgencyPhone: toStringOrNull(raw.transferAgencyPhone),
    transferAgencyAddress: toStringOrNull(raw.transferAgencyAddress),
    auditingFirm: toStringOrNull(raw.auditingFirm),
    auditor1: toStringOrNull(raw.auditor1),
    auditor2: toStringOrNull(raw.auditor2),
    englishShortName: toStringOrNull(raw.englishShortName),
    englishAddress: toStringOrNull(raw.englishAddress),
    faxNumber: toStringOrNull(raw.faxNumber),
    email: toStringOrNull(raw.email),
    website: toStringOrNull(raw.website),
    issuedShares: toStringOrNull(raw.issuedShares),
  };
}

/**
 * Fetches a company's basic-info profile from analysis-ts's GET /companies/profile?symbol=. Null on a
 * 404 (TWSE checked first, then TPEx — analysis-ts only 404s if neither has it). Not filtered by ETF/KY/
 * 興櫃 status — whichever symbol is asked for is returned as-is, per analysis-ts directly.
 */
export async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const url = buildAnalysisServiceUrl("/companies/profile", { symbol });
  const response = await fetchAnalysisService(url);

  if (response.status === 404) {
    return null;
  }
  await assertAnalysisServiceOk(response, url, "Company profile endpoint");

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || typeof (body as { symbol?: unknown }).symbol !== "string") {
    logger.error({ url: url.toString() }, "Company profile endpoint response is missing symbol");
    throw new AppError("Company profile endpoint response is missing symbol", 502);
  }

  return withLegacyProfileKeys(normalizeCompanyProfile(body as Record<string, unknown>));
}
