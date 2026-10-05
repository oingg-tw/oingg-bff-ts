import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import { mapWithConcurrency } from "@/shared/concurrency.js";
import { todayInTaipei } from "@/shared/taipeiDate.js";

/**
 * /holdings/performance 與 /holdings/risk 共用的市場資料視窗：期間預設值、交易日曆（加權指數的交易日）、
 * 個股收盤價。2026-10-05 從 holdingsPerformance.service.ts 抽出來——兩支端點對「期間怎麼算、多早以前
 * 抓不到」必須是同一個答案，寫兩份遲早會漂。
 */
export type MarketWindowDeps = Pick<AppDeps, "stockGateway" | "marketGateway">;

/** 上游 daily-price-history 的 limit 上限（2026-10-05 實測：2001 回 400）。約 8 年，2330 從 2018-07-17 起。 */
const STOCK_PRICE_LIMIT = 2000;
/** 上游 taiex-daily-price 的 limit 上限（2026-09-22 由 2000 調到 8000）。 */
const TAIEX_LIMIT = 8000;
/**
 * 起點之前多抓幾個交易日的收盤價：起點那天剛好停牌或沒成交時，要沿用的是**更早**的收盤價。
 * 停牌超過這個長度的話會退回用交易價估起點市值。
 */
const CLOSE_LOOKBACK_DAYS = 20;
/** 同時打上游的請求數。一個組合可能有 50 檔以上，全部同時送出對 analysis-ts 不友善。 */
const MAX_CONCURRENT_PRICE_REQUESTS = 6;
const MS_PER_DAY = 86_400_000;

/**
 * 個股日線與加權指數都是全市場公開資料，所有使用者共用同一份快取。
 *
 * 2026-10-05 量測（使用者真實帳本 129 列、近一年期間內曾持有約 50 檔，本機，交錯 7 輪）：
 * /holdings/performance 中位數 2,018 ms，幾乎全花在每次請求重抓這 50 檔的日線（並行 6、約 8 批）；
 * 同一輪的 /holdings/realized 只要 94 ms。過去的收盤價不會變，只有最新一天可能還沒進來，所以 1 小時的
 * TTL 只會讓「今天」的收盤晚一點出現（那天會照常計入 missingPrices）。
 *
 * ponytail: 程序內的 Map，多個 instance 各自一份、重啟就清空；以插入順序淘汰（最舊的先走），上限 500 檔——
 * 一年期約 270 列一檔，500 檔約 13 萬筆，記憶體很小。要跨 instance 共用再換外部快取。
 */
const PRICE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED_SYMBOLS = 500;
const closeCache = new Map<string, { fetchedAt: number; limit: number; closes: Map<string, number> }>();
let taiexCache: { fetchedAt: number; limit: number; entries: { tradeDate: string; close: string | null }[] } | undefined;

/** 只給測試用：模組層的快取會跨測試保留。 */
export function resetMarketWindowCache(): void {
  closeCache.clear();
  taiexCache = undefined;
}

function isFresh(entry: { fetchedAt: number; limit: number } | undefined, limit: number): boolean {
  // 快取的列數要至少涵蓋這次要的——抓得比較多的那份是這次的超集，可以直接用。
  return entry !== undefined && entry.limit >= limit && Date.now() - entry.fetchedAt < PRICE_TTL_MS;
}

async function taiexEntries(limit: number, deps: MarketWindowDeps): Promise<{ tradeDate: string; close: string | null }[]> {
  if (!isFresh(taiexCache, limit)) {
    taiexCache = { fetchedAt: Date.now(), limit, entries: (await deps.marketGateway.getTaiexDailyPrice(limit)).entries };
  }
  return taiexCache!.entries;
}

/** 往前推一年。只有 2/29 在前一年沒有對應日，那天用 2/28（而不是讓 Date 滾到 3/1）。 */
function oneYearBefore(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(year) - 1}-${month}-${month === "02" && day === "29" ? "28" : day}`;
}

export interface TradingWindow {
  /** 實際採用的期間（套用預設值之後），兩端都含。 */
  from: string;
  to: string;
  /** 期間內的交易日（加權指數有開盤的日子），升冪。空的時候 baseDate 也是 undefined。 */
  calendar: string[];
  /** 期間前最後一個交易日；它的收盤是起點。 */
  baseDate: string | undefined;
  /** 抓個股收盤價要給的 limit：涵蓋起點之前 CLOSE_LOOKBACK_DAYS 個交易日。 */
  tradingDaysNeeded: number;
  /** 加權指數收盤（null 的日子不放進來）。 */
  taiexCloses: Map<string, number>;
}

/**
 * 預設期間是到今天（台灣時間）為止的一年。超過個股收盤價能回溯的深度（約 8 年）時回 400 並寫出最早能從
 * 哪天開始——較早的日子會沒有收盤價，算出來是一個看起來正常的錯數字。
 */
export async function resolveTradingWindow(
  requestedFrom: string | undefined,
  requestedTo: string | undefined,
  deps: MarketWindowDeps,
): Promise<TradingWindow> {
  const to = requestedTo ?? todayInTaipei();
  const from = requestedFrom ?? oneYearBefore(to);
  if (from > to) {
    throw new AppError('"from" must not be after "to"', 400);
  }

  // 交易日曆用加權指數的交易日：前端拿 /market/taiex-daily-price 畫大盤，這樣兩條線逐日對得上。
  // 5/7 是交易日佔日曆日比例的上界（國定假日只會讓它更少），再多抓幾天給起點與沿用收盤價。
  const calendarDays = Math.ceil((Date.parse(`${todayInTaipei()}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
  const taiexLimit = Math.min(TAIEX_LIMIT, Math.ceil((Math.max(calendarDays, 0) * 5) / 7) + CLOSE_LOOKBACK_DAYS + 10);
  const entries = await taiexEntries(taiexLimit, deps);
  const taiexDates = entries.map((entry) => entry.tradeDate);
  const taiexCloses = new Map(
    entries.flatMap((entry) => (entry.close === null ? [] : [[entry.tradeDate, Number(entry.close)] as const])),
  );

  let calendar = taiexDates.filter((date) => date >= from && date <= to);
  let baseDate = taiexDates.filter((date) => date < from).at(-1);
  if (calendar.length > 0 && !baseDate) {
    // 期間起點比加權指數的資料還早：拿第一個交易日當起點。
    [baseDate, ...calendar] = calendar;
  }
  if (!baseDate || calendar.length === 0) {
    return { from, to, calendar: [], baseDate: undefined, tradingDaysNeeded: 0, taiexCloses };
  }

  // 個股收盤價只有 limit（最近 N 個交易日），沒有 from/to。從起點往前 CLOSE_LOOKBACK_DAYS 個交易日算起。
  const start = baseDate;
  const tradingDaysNeeded = taiexDates.filter((date) => date >= start).length + CLOSE_LOOKBACK_DAYS;
  if (tradingDaysNeeded > STOCK_PRICE_LIMIT) {
    const earliest = taiexDates.at(-(STOCK_PRICE_LIMIT - CLOSE_LOOKBACK_DAYS));
    // web-nuxt 用正則從這句話抽出「on or after YYYY-MM-DD」的日期再翻成中文（2026-10-05 告知）。
    // 改措辭時請保留那一段；日期只存在訊息裡，因為 AppError 的 details 在 production 會被拿掉。
    throw new AppError(`The range is longer than the available price history; "from" must be on or after ${earliest}`, 400);
  }

  return { from, to, calendar, baseDate, tradingDaysNeeded, taiexCloses };
}

/**
 * symbol → (tradeDate → close)。close 為 null 的日子（有開盤但沒成交）不放進來，讓呼叫端自己決定怎麼沿用。
 * 只有快取沒有（或過期、列數不夠）的代號才打上游，見上面 closeCache 的說明。
 */
export async function fetchCloses(
  symbols: readonly string[],
  limit: number,
  deps: MarketWindowDeps,
): Promise<Map<string, Map<string, number>>> {
  const missing = symbols.filter((symbol) => !isFresh(closeCache.get(symbol), limit));
  const histories = await mapWithConcurrency(missing, MAX_CONCURRENT_PRICE_REQUESTS, (symbol) =>
    deps.stockGateway.getDailyPriceHistory(symbol, limit),
  );
  for (const history of histories) {
    const closes = new Map(history.entries.flatMap((row) => (row.close === null ? [] : [[row.tradeDate, row.close] as const])));
    closeCache.delete(history.symbol); // 重新插入，讓它排到最新——淘汰照插入順序
    closeCache.set(history.symbol, { fetchedAt: Date.now(), limit, closes });
  }
  while (closeCache.size > MAX_CACHED_SYMBOLS) {
    closeCache.delete(closeCache.keys().next().value!);
  }
  return new Map(symbols.map((symbol) => [symbol, closeCache.get(symbol)?.closes ?? new Map<string, number>()]));
}
