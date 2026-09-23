import type { Pagination } from "@/application/proxy/screener/pagination.js";
import type {
  CompanyRankResult,
  DistributionResult,
  ScreenerColumnRef,
  ScreenerFilter,
  ScreenerGatewayResult,
  ScreenerRankingGatewayResult,
  ScreenerSort,
  ScreenerValuesGatewayResult,
  ValuationRankingMetric,
  ValuationRankingResult,
} from "@/application/proxy/screener/screener.types.js";

/**
 * 選股引擎的對外取得 port（analysis-ts 的 POST /screener、/screener/values、GET /screener/ranking、
 * /screener/company-rank、/screener/distribution，以及 GET /valuation/ranking）。實作住
 * infrastructure/analysisApi/screener/analysisScreenerClient.ts 的檔尾。
 *
 * 一個切片一個 port：getValuationRanking 打的是另一條路徑（/valuation/ranking，不在 /screener 底下）、
 * 實作也在另一個檔案（valuationRanking.client.ts），但它是同一個上游服務為同一個問題（排行是二階計算，
 * 不該由 BFF 自己算）提供的答案，拆成兩個 port 只會讓呼叫端多拿一個依賴、少一份全貌。
 *
 * 邊界在哪裡：這個 port 只負責「送出去、把回應驗成我們的形狀」。欄位要不要先對本地型錄驗、
 * "stock.price" 要不要合併進來、哪個 field 該改走 valuation 路徑——全部留在 screener.service.ts，
 * 因為那些是規則，不是傳輸。
 */
export interface ScreenerGatewayPort {
  /**
   * 完整的篩選＋分頁查詢。排序在上游是對「全部符合的公司」做完才分頁（不是只排這一頁），且會用 symbol
   * 當穩定的 tiebreaker——換實作時這個語意要一起帶走，不然分頁會在重複值上跳row。
   */
  runScreener(
    filters: ScreenerFilter[],
    columns: ScreenerColumnRef[],
    pagination: Pagination,
    sort?: ScreenerSort,
    sectorCodes?: string[],
    excludeSectorCodes?: string[],
  ): Promise<ScreenerGatewayResult>;

  /**
   * 單一指標的 Top-N 排行。被排序的那個 field 一定會出現在每一列的 values 裡（上游相對 runScreener 的
   * 刻意不對稱，已跟 analysis-ts 確認過），所以 `extraColumns` 只放呼叫端額外要顯示的欄位。
   */
  runRanking(
    field: string,
    direction: "asc" | "desc",
    limit: number,
    extraColumns: ScreenerColumnRef[],
    sectorCodes?: string[],
    excludeSectorCodes?: string[],
  ): Promise<ScreenerRankingGatewayResult>;

  /** 對一份已知的 symbol 清單只取指定欄位——沒有 filter、沒有分頁（見 runScreenerValues）。 */
  getValues(symbols: string[], columns: ScreenerColumnRef[]): Promise<ScreenerValuesGatewayResult>;

  /**
   * 單一公司在全市場的名次／百分位。欄位有效性交給上游判定，這裡沒有本地型錄驗證——這個回應沒有顯示欄位
   * （metricName/fieldName），所以沒有東西需要對本地型錄解析，跟 runScreener/runRanking 不同。
   *
   * 注意 `topPercent` 越小代表名次越好（5 = 市場前 5%），跟一般百分位方向相反；`found: false`（這個
   * 欄位對這檔沒資料，或這檔根本不存在）仍然是 200，不是 404。
   *
   * `excludeZero` 跟 getDistribution 同一個語意：true 時把該欄位剛好等於 0 的公司排除在母體外。對殖利率
   * 這種欄位差別很大——不配息的公司殖利率是 0，不排除的話「有配息公司中的排名」會被它們稀釋。只影響
   * totalCount／topPercent，rank 不變（被排除的零值在降冪排序裡本來就排在後面）。
   */
  getCompanyRank(
    symbol: string,
    field: string,
    direction: "asc" | "desc",
    excludeZero: boolean | undefined,
  ): Promise<CompanyRankResult>;

  /**
   * 單一欄位的全市場分布（直方圖）。跟 getCompanyRank 同一個慣例：field/bins 的驗證交給上游。
   * bins/excludeZero 用 optional，省略時不送出該參數，上游才會套用它自己的預設分桶。
   */
  getDistribution(field: string, bins: number | undefined, excludeZero: boolean | undefined): Promise<DistributionResult>;

  /**
   * 本益比／股價淨值比／殖利率的專用排行端點。排行是對原始市場資料的二階計算（排序、取前 N、排除非正的
   * P/E 或 P/B），已經有 analysis-ts 這個擁有者，BFF 不自己算——這是這個方法存在的全部理由，見
   * [[feedback_bff_minimize_data_ownership]]。
   */
  getValuationRanking(
    metric: ValuationRankingMetric,
    order: "asc" | "desc",
    limit: number,
  ): Promise<ValuationRankingResult>;
}
