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

/**
 * GET /holdings/performance 的回應：持股組合在一段期間的時間加權報酬（TWR），用來跟大盤比。
 * 計算規則見 domain/portfolioReturn.ts。報酬率都是**小數字串**（"0.123456" = 12.3456%），6 位。
 */
export interface PortfolioPerformanceReport {
  /** 實際採用的期間（套用預設值之後），兩端都含。 */
  from: string;
  to: string;
  /** 整段期間都沒有曝險時是 null——那不是「報酬 0」，是沒有東西可以算。 */
  twr: string | null;
  /**
   * 期間內每個交易日（以加權指數的交易日為準，所以跟 /market/taiex-daily-price 逐日對得上）收盤後的
   * 累積報酬，舊到新。第一次有曝險之前的日子是 null。
   */
  series: { date: string; cumulative: string | null }[];
  /** 有持股但當天沒有收盤價（沿用前一個收盤價、或退回交易價）的天數，依 symbol 升冪。 */
  missingPrices: { symbol: string; dates: number }[];
}
