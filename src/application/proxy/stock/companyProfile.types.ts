export type CompanyProfileMarket = "TWSE" | "TPEx";

/**
 * Company basic-info profile from oingg-analysis-ts's GET /companies/profile — sourced from their
 * twse/tpex Prisma connections' `company_profile` table (TWSE checked first, then TPEx). `market` tells
 * the caller which one actually matched, unlike GET /stocks/:symbol/quote which deliberately hides this.
 * TPEx has no `englishAddress` field at all — always null there, not a query failure.
 */
export interface CompanyProfile {
  symbol: string;
  market: CompanyProfileMarket;
  reportDate: string;
  name: string;
  shortName: string;
  foreignRegistrationCountry: string | null;
  industry: string | null;
  /** Human-readable label for `industry` (e.g. "半導體業" for code "24"). TWSE's company_profile has this natively; TPEx's export doesn't (always null there, pending tpex-ts) — analysis-ts deliberately isn't guessing a code table for it. Added 2026-09-02. */
  industryName: string | null;
  address: string | null;
  taxId: string | null;
  chairman: string | null;
  generalManager: string | null;
  spokesperson: string | null;
  spokespersonTitle: string | null;
  deputySpokesperson: string | null;
  phone: string | null;
  establishedDate: string | null;
  listedDate: string | null;
  /** Par value per share (usually NT$10) — Decimal-backed, normalized to a string like every other numeric value in bff-ts's outward API. */
  parValue: string | null;
  /** BigInt-backed on analysis-ts's side (already a string there) — kept as a string here too, to avoid float-precision loss on very large capital/share-count figures. */
  paidInCapital: string | null;
  privatePlacementShares: string | null;
  preferredStockShares: string | null;
  /** The exchange's raw 編製財務報告類型 code: "1" = 合併 (consolidated), "2" = 個別 (individual). Note this is the OPPOSITE numbering from `metricDataType` below. */
  financialReportType: string | null;
  /**
   * Human-readable label for `financialReportType`. Corrected by analysis-ts 2026-09-22 (21fdd2d4): the
   * mapping was originally written backwards ("1" -> 個別), because the exchange's code and MOPS's dataType
   * number the two report types in opposite directions — 2330 (code "1") is now correctly "合併財報".
   */
  financialReportTypeName: string | null;
  /**
   * Which financial-statement basis analysis-ts actually uses for this company's metrics — MOPS dataType
   * numbering: "2" = 合併報表 (consolidated), "1" = 個體報表 (individual). Added 2026-09-22 (21fdd2d4). Most
   * companies are "2"; ~249 that only file individual statements (mostly 興櫃, plus e.g. 2816/2820/2836/
   * 2849/2851/5863) are "1" and only began getting metric values with this change. Deliberately typed as a
   * closed union since analysis-ts declares it as a two-value enum.
   */
  metricDataType: "1" | "2";
  stockTransferAgency: string | null;
  transferAgencyPhone: string | null;
  transferAgencyAddress: string | null;
  auditingFirm: string | null;
  auditor1: string | null;
  auditor2: string | null;
  englishShortName: string | null;
  /** Always null for a TPEx-listed company — TPEx's source data has no equivalent field. */
  englishAddress: string | null;
  faxNumber: string | null;
  email: string | null;
  website: string | null;
  issuedShares: string | null;
}
