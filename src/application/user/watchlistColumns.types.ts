/**
 * 自選股表格的一個顯示欄位（使用者 2026-10-06 決定）。field 是型錄欄位（"metricCode.token"）、報價特殊欄位
 * （stock.price／stock.previousClose），或前端自己算的兩個合成欄位（見 watchlistColumns.service.ts）。
 * label 是使用者看到的欄名。
 */
export interface WatchlistColumn {
  field: string;
  label: string;
}

export interface WatchlistColumnsPreferences {
  /** null＝從來沒存過，前端套用自己的預設；[]＝刻意存了一份空清單。兩者不同。 */
  columns: WatchlistColumn[] | null;
}
