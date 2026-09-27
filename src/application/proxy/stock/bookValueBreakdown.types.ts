/**
 * 一個年度的每股淨值變動拆解，單位是元／股。
 *
 * **每一列都是恆等式**：`openingBvps` 加上中間 6 個變動項等於 `closingBvps`。
 * 實測容差要用 **0.02 不是 0.01**——7 個加項各自四捨五入到 2 位小數，殘差自然會到 ±0.02
 * （2026-09-27 抽 40 家、197 列：18.8% 的列殘差是 0.01 或 0.02，沒有一列更大，
 * 最大絕對值 0.02 出現在 1268 的 2021 與 1536 的 2025）。所以這不是資料問題，
 * 而下游若要驗這個恆等式，門檻設 0.01 會誤判約兩成的列。
 *
 * 全部欄位都是 number、不可為 null（實測 40 家 197 列零個 null，上游也明確保證），
 * 所以缺欄位一律在邊界丟 502 而不是靜默給 0——理由見 analysisServiceClient 的 requireNumber。
 */
export interface BookValueBreakdownEntry {
  fiscalYear: number;
  /** 年初每股淨值。 */
  openingBvps: number;
  /** 本期淨利對每股淨值的貢獻。 */
  netIncome: number;
  /** 其他綜合損益（OCI）。 */
  otherComprehensiveIncome: number;
  /** 現金股利，**負值**（2330 的 2025 年度是 −20.5）。 */
  cashDividends: number;
  /** 現金增資、可轉債轉換等發行新股帶來的變動。 */
  capitalIssued: number;
  /**
   * 股數變動本身造成的每股淨值稀釋或增厚（配股、分割、減資）。權益總額不變而分母變了的那一塊，
   * 跟 capitalIssued 是兩件事：後者是真的有錢進來。
   */
  shareCountEffect: number;
  /** 上面幾項都歸不進去的殘餘（庫藏股、非控制權益調整等）。 */
  other: number;
  /** 年末每股淨值。 */
  closingBvps: number;
}

export interface BookValueBreakdownResult {
  symbol: string;
  /** 由舊到新，一年一列。查無資料時是空陣列（不是 404）。 */
  entries: BookValueBreakdownEntry[];
}
