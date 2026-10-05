/** 一家券商（analysis-ts 的 GET /brokers，2026-10-05 新增，資料來自 twse-ts export.broker，每日更新）。 */
export interface Broker {
  /** 券商代號，例如 "9800"。 */
  brokerCode: string;
  /** 全名。**目前一律 null**：來源只有簡稱（2026-10-05 實測 60/60 家都是 null），不是我們漏接。 */
  name: string | null;
  /** 簡稱，例如 9800 →「元大」。下拉選單顯示用這個。 */
  shortName: string;
}

export interface BrokerList {
  /** "YYYY-MM-DD"，名單最後更新日；上游沒有日期時是 null。 */
  asOfDate: string | null;
  /** 依 brokerCode 排序（2026-10-05 實測：已排序、代號不重複）。 */
  brokers: Broker[];
}
