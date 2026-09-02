import { AppError } from "@/shared/errorHandler.js";
import { requireEnv } from "@/shared/env.js";
import type { CompanyProfile } from "@/domains/stock/companyProfile.types.js";

/** Same convention as stockQuote.client.ts's toStringOrNull — see that file for why. */
function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function normalizeCompanyProfile(raw: Record<string, unknown>): CompanyProfile {
  return {
    symbol: String(raw.symbol),
    market: raw.market === "TPEx" ? "TPEx" : "TWSE",
    reportDate: String(raw.reportDate),
    name: String(raw.name),
    shortName: String(raw.shortName),
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
 * Fetches a company's basic-info profile from analysis-ts's GET /companies/profile?companyId=. Null on a
 * 404 (TWSE checked first, then TPEx — analysis-ts only 404s if neither has it). Not filtered by ETF/KY/
 * 興櫃 status — whichever symbol is asked for is returned as-is, per analysis-ts directly.
 */
export async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const url = new URL("/companies/profile", requireEnv("FILTERS_SERVICE_URL"));
  url.searchParams.set("companyId", symbol);

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new AppError(
      `Could not reach the analysis service at ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new AppError(`Company profile endpoint returned ${response.status} for ${url.toString()}`, 502);
  }

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || typeof (body as { symbol?: unknown }).symbol !== "string") {
    throw new AppError(`Company profile endpoint response at ${url.toString()} is missing symbol`, 502);
  }

  return normalizeCompanyProfile(body as Record<string, unknown>);
}
