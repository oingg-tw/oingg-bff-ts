import { AppError } from "@/domain/appError.js";
import { computePortfolioReturn } from "@/domain/portfolioReturn.js";
import { toLedgerEntry } from "@/application/transactions/transactions.service.js";
import type { AppDeps } from "@/application/deps.js";
import type { PortfolioPerformanceReport } from "@/application/holdings/holdings.types.js";

/**
 * GET /holdings/performance 的編排：決定期間、取交易日曆與收盤價、交給 domain 算 TWR。
 *
 * 這不是代理端點——輸入是這個服務自己擁有的交易紀錄，analysis-ts 只提供公開的收盤價，它不該、也
 * 不會知道任何使用者的持股。所以「衍生計算屬於擁有資料的服務」在這裡指的就是 bff-ts。
 */
export type HoldingsPerformanceDeps = Pick<AppDeps, "transactions" | "stockGateway" | "marketGateway">;

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
const RETURN_DECIMALS = 6;
const MS_PER_DAY = 86_400_000;

/** 台灣時間的今天。用 UTC 的話，台灣早上 8 點以前會被當成前一天。 */
function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

/** 往前推一年。只有 2/29 在前一年沒有對應日，那天用 2/28（而不是讓 Date 滾到 3/1）。 */
function oneYearBefore(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(year) - 1}-${month}-${month === "02" && day === "29" ? "28" : day}`;
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * ponytail: 沒有快取，每次請求都重抓每一檔的收盤價（一年、26 檔約 26 次上游呼叫，並行 6 個）。
 * 過去的收盤價不會變，所以要加快取的話以 (symbol, limit) 為鍵的 LRU 是安全的——等延遲或上游負載
 * 真的成為問題再加。
 */
export async function getPortfolioPerformance(
  firebaseUid: string,
  requestedFrom: string | undefined,
  requestedTo: string | undefined,
  deps: HoldingsPerformanceDeps,
): Promise<PortfolioPerformanceReport> {
  const to = requestedTo ?? todayInTaipei();
  const from = requestedFrom ?? oneYearBefore(to);
  if (from > to) {
    throw new AppError('"from" must not be after "to"', 400);
  }

  const empty: PortfolioPerformanceReport = { from, to, twr: null, series: [], missingPrices: [] };

  // 交易日曆用加權指數的交易日：前端拿 /market/taiex-daily-price 畫大盤，這樣兩條線逐日對得上。
  // 5/7 是交易日佔日曆日比例的上界（國定假日只會讓它更少），再多抓幾天給起點與沿用收盤價。
  const calendarDays = Math.ceil((Date.parse(`${todayInTaipei()}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
  const taiexLimit = Math.min(TAIEX_LIMIT, Math.ceil((Math.max(calendarDays, 0) * 5) / 7) + CLOSE_LOOKBACK_DAYS + 10);
  const taiexDates = (await deps.marketGateway.getTaiexDailyPrice(taiexLimit)).entries.map((entry) => entry.tradeDate);

  let calendar = taiexDates.filter((date) => date >= from && date <= to);
  let baseDate = taiexDates.filter((date) => date < from).at(-1);
  if (calendar.length === 0) {
    return empty;
  }
  if (!baseDate) {
    // 期間起點比加權指數的資料還早：拿第一個交易日當起點。
    [baseDate, ...calendar] = calendar;
    if (!baseDate || calendar.length === 0) {
      return empty;
    }
  }

  // 個股收盤價只有 limit（最近 N 個交易日），沒有 from/to。從起點往前 CLOSE_LOOKBACK_DAYS 個交易日算起。
  const tradingDaysNeeded = taiexDates.filter((date) => date >= baseDate).length + CLOSE_LOOKBACK_DAYS;
  if (tradingDaysNeeded > STOCK_PRICE_LIMIT) {
    // 超過上游能回溯的深度時，較早的日子會沒有收盤價、只能用交易價估值——那是一個看起來正常的錯數字。
    // 寧可明確拒絕，並告訴呼叫端最早可以從哪天開始。
    const earliest = taiexDates.at(-(STOCK_PRICE_LIMIT - CLOSE_LOOKBACK_DAYS));
    throw new AppError(`The range is longer than the available price history; "from" must be on or after ${earliest}`, 400);
  }

  const entries = (await deps.transactions.list(firebaseUid)).map(toLedgerEntry).filter((entry) => entry.tradeDate <= to);

  // 只抓期間內（含起點）真的有持股的代號：起點前已經出清、之後也沒再碰的不用抓。
  const quantityAtBase = new Map<string, number>();
  const tradedInWindow = new Set<string>();
  for (const entry of entries) {
    if (entry.tradeDate <= baseDate) {
      const sign = entry.action === "BUY" ? 1 : -1;
      quantityAtBase.set(entry.symbol, (quantityAtBase.get(entry.symbol) ?? 0) + sign * entry.quantity);
    } else {
      tradedInWindow.add(entry.symbol);
    }
  }
  const symbols = [...new Set([...[...quantityAtBase].filter(([, q]) => q > 0).map(([s]) => s), ...tradedInWindow])];

  const histories = await mapWithConcurrency(symbols, MAX_CONCURRENT_PRICE_REQUESTS, (symbol) =>
    deps.stockGateway.getDailyPriceHistory(symbol, tradingDaysNeeded),
  );
  const closes = new Map(
    histories.map((history) => [
      history.symbol,
      // close 為 null 的日子（有開盤但沒成交）不放進來，讓 domain 沿用前一個收盤價並計入 missingPrices。
      new Map(history.entries.flatMap((row) => (row.close === null ? [] : [[row.tradeDate, row.close] as const]))),
    ]),
  );

  const result = computePortfolioReturn({ entries, calendar, baseDate, closes });

  return {
    from,
    to,
    twr: result.twr === null ? null : result.twr.toFixed(RETURN_DECIMALS),
    series: result.series.map((point) => ({
      date: point.date,
      cumulative: point.cumulative === null ? null : point.cumulative.toFixed(RETURN_DECIMALS),
    })),
    missingPrices: [...result.missingPriceDays]
      .map(([symbol, dates]) => ({ symbol, dates }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}
