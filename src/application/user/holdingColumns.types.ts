export type HoldingColumnFormat = "number" | "percent" | "money";

/**
 * 持股頁的一個自訂欄位（使用者 2026-10-05 要求，比照 Excel 的公式欄）。
 *
 * `formula` 是 Excel 風格的字串（例如 "=D/A"、"=ROUND(E/B*100, 2)"），**bff-ts 只存、不解析**：計算發生在
 * 瀏覽器裡、對使用者自己的持股。欄位字母由 web-nuxt 定義（A 股數、B 平均成本……自訂欄位從 H 開始依清單順序），
 * 所以清單的**順序本身就是公式參照的一部分**——重排會改變字母，那是前端的責任（它會像 Excel 一樣改寫參照）。
 */
export interface HoldingColumn {
  id: string;
  label: string;
  formula: string;
  format: HoldingColumnFormat;
  decimals: number;
}

export interface HoldingColumnsPreferences {
  /** null＝從來沒存過，前端套用自己的預設；[]＝刻意存了一份空清單。兩者不同。 */
  columns: HoldingColumn[] | null;
}
