import type { LedgerEntry } from "@/domain/holdingProjection.js";
import { withStockDividends, type AppliedStockDividend, type StockDividendEvent } from "@/domain/stockDividends.js";
import type { AppDeps } from "@/application/deps.js";
import { mapWithConcurrency } from "@/shared/concurrency.js";
import { todayInTaipei } from "@/shared/taipeiDate.js";

/**
 * 帳本 → 補上自動配股的帳本。**每一個用到持股重算的地方都必須經過這裡**：GET /holdings、
 * /holdings/realized、/holdings/performance、單筆寫入的賣超驗證、匯入、撤銷、GET /transactions。
 * 漏掉任何一處，那一處就會跟其他地方算出不一樣的持股——例如顯示得出 12,628 股，賣的時候卻被擋成賣超。
 */
export type StockDividendDeps = Pick<AppDeps, "stockGateway">;

/**
 * 除權息行事曆有資料的第一個月。2026-10-05 實測：2018-08、2015-08 都是 0 列，2019 每月約 25 列
 * （稀疏），2020 年中以後完整（每年 8 月 300 列以上）。更早的月份不去打——那只是一串空回應。
 * 更早的配股因此不會自動入帳；它們會以「匯入時賣超」的形式出現，使用者可以補上，不會悄悄算錯。
 */
const CALENDAR_FIRST_MONTH = "2019-01";
const MAX_CONCURRENT_MONTH_REQUESTS = 6;

/**
 * 行事曆是全市場、逐月的資料，所有使用者共用，所以快取的命中率很高。過去的月份幾乎不會變，當月與
 * 未來的月份還會有新的除權公告。
 * ponytail: 程序內的 Map，重啟就清空、多個 instance 各自一份；月份數有上限（2019 起每年 12 個），
 * 不需要淘汰機制。要跨 instance 共用再換外部快取。
 */
const PAST_MONTH_TTL_MS = 24 * 60 * 60 * 1000;
const CURRENT_MONTH_TTL_MS = 60 * 60 * 1000;
const monthCache = new Map<string, { fetchedAt: number; events: StockDividendEvent[] }>();

/** 只給測試用：模組層的快取會跨測試保留，不清掉的話後面的測試會讀到前面測試的資料。 */
export function resetStockDividendCache(): void {
  monthCache.clear();
}

function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const months: string[] = [];
  let [year, month] = fromMonth.split("-").map(Number) as [number, number];
  for (let current = fromMonth; current <= toMonth; ) {
    months.push(current);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    current = `${year}-${String(month).padStart(2, "0")}`;
  }
  return months;
}

async function eventsForMonth(month: string, currentMonth: string, deps: StockDividendDeps): Promise<StockDividendEvent[]> {
  const cached = monthCache.get(month);
  const ttl = month < currentMonth ? PAST_MONTH_TTL_MS : CURRENT_MONTH_TTL_MS;
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.events;
  }
  const calendar = await deps.stockGateway.getExDividendCalendar(month);
  /**
   * stockDividendRatio 是「每股配幾股」，已經跟面額無關（見 domain/stockDividends.ts 為什麼不用
   * stockDividend ÷ 10）。「權」也涵蓋現金增資認購，但那用的是 subscriptionRatio，兩者不會同時出現
   * 在同一列，所以只看 stockDividendRatio > 0 就不會把要付錢的認購當成配股。
   */
  const events = calendar.entries
    .filter((row) => typeof row.stockDividendRatio === "number" && row.stockDividendRatio > 0)
    .map((row) => ({ symbol: row.symbol, exRightsDate: row.exDate, sharesPerShare: row.stockDividendRatio! }));
  monthCache.set(month, { fetchedAt: Date.now(), events });
  return events;
}

/**
 * 這幾檔從 `fromDate` 起到今天、已經除權的配股事件（比例是行事曆的 stockDividendRatio）。
 * applyStockDividends 用它入帳配股；/holdings/risk 用它還原除權造成的股價斷層。兩邊共用同一份月快取。
 */
export async function stockDividendEventsFor(
  symbols: ReadonlySet<string>,
  fromDate: string,
  deps: StockDividendDeps,
): Promise<StockDividendEvent[]> {
  const today = todayInTaipei();
  const currentMonth = today.slice(0, 7);
  const fromMonth = fromDate.slice(0, 7);
  const months = monthsBetween(fromMonth < CALENDAR_FIRST_MONTH ? CALENDAR_FIRST_MONTH : fromMonth, currentMonth);
  const perMonth = await mapWithConcurrency(months, MAX_CONCURRENT_MONTH_REQUESTS, (month) => eventsForMonth(month, currentMonth, deps));
  // 除權日還沒到的（當月行事曆裡的預告）不算：那些股數還不存在。
  return perMonth.flat().filter((event) => symbols.has(event.symbol) && event.exRightsDate >= fromDate && event.exRightsDate <= today);
}

export async function applyStockDividends(
  entries: readonly LedgerEntry[],
  deps: StockDividendDeps,
): Promise<{ entries: LedgerEntry[]; dividends: AppliedStockDividend[] }> {
  if (entries.length === 0) {
    return { entries: [], dividends: [] };
  }
  const earliest = entries.reduce((min, entry) => (entry.tradeDate < min ? entry.tradeDate : min), entries[0]!.tradeDate);
  const events = await stockDividendEventsFor(new Set(entries.map((entry) => entry.symbol)), earliest, deps);
  return withStockDividends(entries, events);
}
