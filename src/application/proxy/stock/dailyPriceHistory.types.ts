export interface DailyPriceHistoryEntry {
  tradeDate: string;
  /**
   * OHLC 在「是交易日但當天沒有成交」的列上是 **null**，而 volume 仍然是實數（2321 的 2026-09-24 是
   * open/high/low/close 全 null、volume 377；1538 連續四天都是這樣，volume 1252/110/167/1）。
   * analysis-ts 推測那些量是零股或盤後交易，未查證。
   *
   * **這幾個欄位曾經宣告成 `number`，而 client 用 `Number(r.close)` 正規化——`Number(null)` 是 0，
   * 所以那些列在下游變成「收盤 0 元」**，前端畫出來是掉到零的斷崖（2026-09-27 修，實測抽 51 檔有 4 檔
   * 中招）。這支端點刻意保留沒成交的交易日（前端需要知道「那天有開盤但沒成交」），所以 null 不是缺漏，
   * 是那一天的事實——不要再收斂成 0，也不要把整列濾掉。
   */
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  /** 即使 OHLC 全是 null 也可能非 0，見上面的說明。 */
  volume: number;
}

export interface DailyPriceHistoryResult {
  symbol: string;
  /** Oldest to newest (confirmed live, 2026-09-10) — same ordering as metric-history/roe-history/etc. */
  entries: DailyPriceHistoryEntry[];
  /**
   * This symbol's earliest trade date on file in the whole database — NOT affected by this call's own
   * `limit` (added by analysis-ts 2026-09-16). Meant for web-nuxt's "大盤連動程度" comparison chart's
   * 1/2/3/5/8-year range picker: compare this date against today to know exactly how much real history a
   * symbol has (e.g. a recent IPO), instead of estimating "~250 trading days per year". Null when the
   * symbol has no price history at all.
   */
  earliestAvailableTradeDate: string | null;
}
