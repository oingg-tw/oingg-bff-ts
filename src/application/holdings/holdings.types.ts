/**
 * GET /holdings 的一列。
 *
 * **2026-10-05 起這不是一列資料庫紀錄，而是交易紀錄的投影**（見 domain/holdingProjection.ts）。
 * 所以舊契約的 `id`、`note`、`createdAt`、`updatedAt` 都消失了：它們是那一列的屬性，而那一列不存在了。
 * 這個資源現在的鍵是 symbol——本來也是（舊表的 unique constraint 就是 (firebaseUid, symbol)）。
 *
 * 金額維持字串，跟舊契約一樣：前端照字串顯示就不會踩到 JSON number 的精度，而且跟
 * StockTransaction 的 price/fee/tax 一致。小數位固定 4 位，對齊交易紀錄的 `Decimal(18,4)` 欄位。
 */
export interface Holding {
  symbol: string;
  quantity: number;
  /** 移動平均成本，含買進手續費。 */
  averageCost: string;
  /** `quantity × averageCost`，也就是這個部位目前的總投入成本。 */
  totalCost: string;
  /**
   * 這個代號到目前為止的已實現損益（賣出價金 − 賣出手續費 − 交易稅 − 賣出股數 × 當時均價）。
   * 可以是負數。**已出清的代號不會出現在清單裡**，所以它那段已實現損益在這裡看不到——
   * 要看已出清的、或只看某段期間的，用 GET /holdings/realized。
   */
  realizedProfitLoss: string;
}

/**
 * GET /holdings/realized 的回應：指定區間內**每一檔有賣出**的已實現損益，含已出清的代號。
 *
 * 跟 GET /holdings 分開的理由：GET /holdings 的每一列是「現在」的部位（股數、均價），而這裡是一個
 * **區間**的損益。把兩個時間尺度塞進同一列（web-nuxt 原本提的 includeClosed + from/to 方案）會讓
 * 「股數是今天的、已實現損益是去年的」並排出現，讀的人很難不誤會。
 */
export interface RealizedProfitLossReport {
  /** 原樣回傳請求的區間；省略時是 null（＝全部期間）。 */
  from: string | null;
  to: string | null;
  /** 依 symbol 升冪。只有區間內至少一筆賣出的代號才會出現。 */
  symbols: { symbol: string; realizedProfitLoss: string }[];
  /** 上面各列（已四捨五入到 4 位）的加總，所以畫面上的列一定加得起來等於它。 */
  totalRealizedProfitLoss: string;
}
