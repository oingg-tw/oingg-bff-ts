/**
 * 一個年度的每股淨值變動拆解，單位是元／股。
 *
 * **每一列都是恆等式，而且精確到分**：`openingBvps` 加上中間 6 個變動項等於 `closingBvps`。
 * 2026-09-27 抽 170 家、844 列實測，用整數分計算的殘差 844/844 都是 0。
 *
 * **驗它請用 `Math.round(sum * 100) === Math.round(closingBvps * 100)`，不要用 `abs(resid) > 0.01`。**
 * 後者在浮點下本身就不可用——0.01 這個十進位小數存不進 binary float，所以殘差為零的列會被算成
 * 0.010000000000019327 之類的值而誤判。這不是容差要調大，是比較方式要換。
 *
 * 歷史脈絡（別重走）：上游一度是各項獨立四捨五入，殘差真的有 ±0.01~0.02，我因此在這裡寫過
 * 「容差用 0.02」。web-nuxt 指出浮點那一點、analysis-ts 則從根本修掉（commit b1ce115f）——先把各項
 * 四捨五入，再用「期末 − 期初 − 各項」倒推 other，讓進位差額由 other 吸收。所以現在不需要任何容差。
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
  /**
   * 上面幾項都歸不進去的殘餘（庫藏股、非控制權益調整等），**外加恆等式的進位差額**。
   *
   * 2026-09-27 起上游刻意讓這一欄吸收各項四捨五入後的差額（commit b1ce115f），換來「恆等式精確到分」。
   * 副作用：**沒有未分類項目的公司這一欄原本是 0，現在可能是 ±0.01~0.02**（實測 10 家裡 12 列如此，
   * 例如 2330 的 2023 是 0.02、2412 的 2023 是 −0.01）。所以不要把 `other !== 0` 讀成「這家公司有特殊的
   * 權益調整」，那個量級的值可能只是進位差。
   */
  other: number;
  /** 年末每股淨值。 */
  closingBvps: number;
}

export interface BookValueBreakdownResult {
  symbol: string;
  /** 由舊到新，一年一列。查無資料時是空陣列（不是 404）。 */
  entries: BookValueBreakdownEntry[];
}
