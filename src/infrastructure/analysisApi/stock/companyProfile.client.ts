import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { CompanyProfile } from "@/application/proxy/stock/companyProfile.types.js";
import type { Market } from "@/application/proxy/market/market.types.js";

/** Same convention as stockQuote.client.ts's toStringOrNull — see that file for why. */
function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function isMetricDataType(value: unknown): value is "1" | "2" {
  return value === "1" || value === "2";
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
  if (value === "TPEx" || value === "TWSE") {
    return value;
  }
  logger.warn({ symbol, market: value }, "Company profile has an unrecognized market — defaulting to TWSE");
  return "TWSE";
}

function normalizeCompanyProfile(raw: Record<string, unknown>): CompanyProfile {
  if (!isMetricDataType(raw.metricDataType)) {
    throw new AppError(`Company profile for "${String(raw.symbol)}" has an unrecognized metricDataType`, 502);
  }
  return {
    symbol: String(raw.symbol),
    metricDataType: raw.metricDataType,
    market: normalizeProfileMarket(raw.market, String(raw.symbol)),
    // 缺席給 null 不給 false——理由見 companyProfile.types.ts。上游 PRD 還沒有這個欄位，而把興櫃說成
    // 「不是興櫃」是錯的標籤；null 讓呼叫端知道「還不知道」。
    isEmerging: typeof raw.isEmerging === "boolean" ? raw.isEmerging : null,
    reportDate: toStringOrNull(raw.reportDate),
    name: toStringOrNull(raw.name),
    shortName: toStringOrNull(raw.shortName),
    foreignRegistrationCountry: toStringOrNull(raw.foreignRegistrationCountry),
    industry: toStringOrNull(raw.industry),
    industryName: toStringOrNull(raw.industryName),
    address: toStringOrNull(raw.address),
    taxId: toStringOrNull(raw.taxId),
    chairman: toStringOrNull(raw.chairman),
    generalManager: toStringOrNull(raw.generalManager),
    spokesperson: toStringOrNull(raw.spokesperson),
    spokespersonTitle: toStringOrNull(raw.spokespersonTitle),
    deputySpokesperson: toStringOrNull(raw.deputySpokesperson),
    phone: toStringOrNull(raw.phone),
    establishedDate: toStringOrNull(raw.establishedDate),
    listedDate: toStringOrNull(raw.listedDate),
    parValue: toStringOrNull(raw.parValue),
    paidInCapital: toStringOrNull(raw.paidInCapital),
    privatePlacementShares: toStringOrNull(raw.privatePlacementShares),
    preferredStockShares: toStringOrNull(raw.preferredStockShares),
    financialReportType: toStringOrNull(raw.financialReportType),
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

  return normalizeCompanyProfile(body as Record<string, unknown>);
}
