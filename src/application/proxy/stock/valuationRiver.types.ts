export type ValuationRiverRatio = "pe" | "pb" | "ps";

/**
 * 估值河流圖（analysis-ts GET /companies/valuation-river，2026-10-08 起代理）。原樣轉發，形狀是 analysis-ts 的；
 * 可為 null 的欄位照上游 OpenAPI 保留 null，不補 0。
 */
export interface ValuationRiverResult {
  symbol: string;
  ratio: ValuationRiverRatio;
  /** 上游給的中文方法說明（河道怎麼畫、基準什麼時候生效、怎麼換算股數基準）。 */
  basisNote: string;
  /** from／to 是實際涵蓋的日期；資料不足時 from 比要求的晚，查無資料時兩者是 null。 */
  lookback: { requestedYears: number; from: string | null; to: string | null };
  sampleDays: number;
  /** 六條河道線的倍數（由低到高）。樣本不足時 null。 */
  bandMultiples: number[] | null;
  ratioRange: { min: number; max: number } | null;
  /** 最新一天；查無代號時整個是 null。基準 ≤ 0（近四季虧損）時 base 照給負數，ratio／percentile 是 null（2026-10-08 實測 1314、6116）。 */
  current: { tradeDate: string; price: number; base: number | null; ratio: number | null; percentile: number | null } | null;
  /** 每日收盤，已換算到今天的股數基準。 */
  prices: { tradeDate: string; close: number }[];
  /** 每股基準的生效區間（財報公告日起生效）；base ≤ 0 那幾段沒有比值、不計入倍數。 */
  bases: { effectiveFrom: string; base: number | null; fiscalYear: number; fiscalQuarter: number | null; knowledgeDateIsFallback: boolean }[];
}
