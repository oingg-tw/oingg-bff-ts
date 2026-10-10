import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService, passThroughEnum, renamedField } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { CompanyProfile } from "@/application/proxy/stock/companyProfile.types.js";
import { readMarketFields } from "@/infrastructure/analysisApi/market/marketCode.js";

/** Same convention as stockQuote.client.ts's toStringOrNull — see that file for why. */
function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}


/**
 * 交易所「編製財務報告類型」跟 MOPS dataType 對合併／個別的編號相反：交易所 "1" 合併 = MOPS "2" 合併。
 * 未知代碼回 null，不猜。
 */
function flipDataTypeEncoding(code: string | null): string | null {
  return code === "1" ? "2" : code === "2" ? "1" : null;
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
    // 市場別與興櫃旗標都從 TYPEK 讀（見 marketCode.ts）：上游 2026-10-24 移除 isEmerging、market 換編碼。
    // 分不出時 isEmerging 給 null 不給 false——理由見 companyProfile.types.ts。
    ...readMarketFields(raw, raw.symbol),
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

  return normalizeCompanyProfile(body as Record<string, unknown>);
}
