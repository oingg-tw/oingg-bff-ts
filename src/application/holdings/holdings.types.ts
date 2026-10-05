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
   * 可以是負數。**已出清的代號不會出現在清單裡**，所以它那段已實現損益也看不到了——
   * 需要「歷史已實現損益」的話那是另一個端點，目前沒有人要求。
   */
  realizedProfitLoss: string;
}
