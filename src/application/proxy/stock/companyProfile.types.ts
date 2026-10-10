export type CompanyProfileMarket = "TWSE" | "TPEx" | (string & {}); // 未知的新值照樣放行（passThroughEnum），不再改寫成 TWSE

/**
 * Company basic-info profile from oingg-analysis-ts's GET /companies/profile — sourced from their
 * twse/tpex Prisma connections' `company_profile` table (TWSE checked first, then TPEx). `market` tells
 * the caller which one actually matched, unlike GET /stocks/:symbol/quote which deliberately hides this.
 * TPEx has no `englishAddress` field at all — always null there, not a query failure.
 */
export interface CompanyProfile {
  symbol: string;
  market: CompanyProfileMarket;
  /** 市場別的 MOPS TYPEK：'sii' 上市、'otc' 上櫃、'rotc' 興櫃（2026-10-10 新增；market 之後會改成這個編碼）。分不出時 null。 */
  marketCode: string | null;
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
  /** 出表日（2026-10-10 前叫 reportDate）。 */
  generatedDate: string | null;
  name: string | null;
  shortName: string | null;
  foreignRegistrationCountry: string | null;
  /** 證交所類股代碼（2026-10-10 前叫 industry），例如 "24"。 */
  sectorCode: string | null;
  /**
   * 類股名稱，例如 "半導體業"（2026-10-10 前叫 industryName）。analysis-ts 875ffaaf 起從類股代碼表取值，所以
   * **上櫃公司也有值**——舊的 industryName 在 TPEx 一律是 null（TPEx 的匯出沒有這個欄位）。上市 33 組跟舊值實測 0 差異（analysis-ts 2026-10-10）。
   */
  sectorName: string | null;
  address: string | null;
  taxId: string | null;
  chairman: string | null;
  generalManager: string | null;
  spokesperson: string | null;
  spokespersonTitle: string | null;
  deputySpokesperson: string | null;
  phone: string | null;
  establishedDate: string | null;
  /** 上市（櫃）日期（2026-10-10 前叫 listedDate）。 */
  listingDate: string | null;
  /** Par value per share (usually NT$10) — Decimal-backed, normalized to a string like every other numeric value in bff-ts's outward API. */
  parValue: string | null;
  /** BigInt-backed on analysis-ts's side (already a string there) — kept as a string here too, to avoid float-precision loss on very large capital/share-count figures. */
  paidInCapital: string | null;
  privatePlacementShares: string | null;
  /** 特別股股數（2026-10-10 前叫 preferredStockShares）。 */
  numberOfPreferenceShares: string | null;
  /**
   * 公司申報的財報類型，**MOPS dataType 編碼，跟 `metricDataType` 同方向**："2" = 合併、"1" = 個別。
   * 2026-10-10 前叫 financialReportType，用的是交易所「編製財務報告類型」編碼（"1" = 合併），**方向相反**——
   * 只改名的話，每家公司都會被讀成另一種財報。
   */
  declaredDataType: string | null;
  /**
   * Human-readable label for `declaredDataType`. Corrected by analysis-ts 2026-09-22 (21fdd2d4): the
   * mapping was originally written backwards ("1" -> 個別), because the exchange's code and MOPS's dataType
   * number the two report types in opposite directions — 2330 (code "1") is now correctly "合併財報".
   */
  financialReportTypeName: string | null;
  /**
   * Which financial-statement basis analysis-ts actually uses for this company's metrics — MOPS dataType
   * numbering: "2" = 合併報表 (consolidated), "1" = 個別報表 (individual). Added 2026-09-22 (21fdd2d4). Most
   * companies are "2"; ~249 that only file individual statements (mostly 興櫃, plus e.g. 2816/2820/2836/
   * 2849/2851/5863) are "1" and only began getting metric values with this change. Deliberately typed as a
   * closed union since analysis-ts declares it as a two-value enum.
   */
  metricDataType: "1" | "2" | (string & {});
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
