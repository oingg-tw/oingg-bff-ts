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
  /**
   * 是否為興櫃（上游 2026-10-01 新增）。**在 per-symbol 層級，這是唯一能區分興櫃的欄位**——`market` 只有
   * `'TWSE' | 'TPEx'`，而興櫃在上游也歸在 TPEx（8050 上櫃與 1293 興櫃的 market 都是 'TPEx'，實測）。
   * 判斷依據與 `GET /stocks` 清單的 `isEmerging` 相同（tpex 的 `company_profile.source`）。
   *
   * **宣告成 nullable，雖然上游的 OpenAPI 列為必填**：上游的 PRD 還沒部署這個欄位，所以在那之前打正式
   * 環境會拿不到它。缺席時給 `null` 而**不是 `false`**——`false` 會把興櫃說成「不是興櫃」，那是一個錯的
   * 標籤，而錯的標籤比缺一個標籤糟（同一小時前 market 那個未知值落到 TWSE 的教訓）。拿到 null 的呼叫端
   * 應該維持現狀的行為，而不是斷言任何事。
   *
   * 下游要它的理由：興櫃依法只申報半年報與年報，所以單季指標**永久**為空，頁面要能說「這類公司沒有這個
   * 數字」而不是「尚無資料」——那兩句話對讀者的意思完全不同。
   */
  isEmerging: boolean | null;
  reportDate: string | null;
  name: string | null;
  shortName: string | null;
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
