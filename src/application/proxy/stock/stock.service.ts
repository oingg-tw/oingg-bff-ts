import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";

/**
 * Only the one gateway, taken as the LAST argument — same convention as the 業務中台 services.
 *
 * This file used to hold 23 functions. All but the one below were `getX(args) => fetchX(args)` with no
 * validation or orchestration (this slice's parameter validation lives in the route's zod schemas, which
 * double as the OpenAPI source), so they were deleted rather than rewritten to take `deps`: the routes
 * now call StockGatewayPort directly. Same judgement as the macro slice.
 */
export type StockProxyDeps = Pick<AppDeps, "stockGateway" | "securitiesGateway">;

/** 上游 GET /securities 的 limit 上限（實測 1001 回 400「Too big: expected number to be <=1000」）。 */
const SECURITIES_PAGE_SIZE = 1000;

/**
 * 代號是否存在於有價證券總表。**只在報價查不到時才走這條**，因為它要分頁。
 *
 * 2026-10-05 實測 `GET /securities` 共 2,722 列（COMMON 2,349 ＋ PREFERRED 28 ＋ ETF 345），而 limit
 * 上限 1000，所以最壞 3 次上游呼叫。上游**沒有**單一代號查詢（`?symbol=`／`?search=`／`?q=` 都被靜默
 * 忽略、照回整頁），所以目前只能走成員檢查；哪天上游補了存在查詢端點，這整個函式就該刪掉。
 */
async function isListedSecurity(symbol: string, deps: StockProxyDeps): Promise<boolean> {
  for (let offset = 0; ; offset += SECURITIES_PAGE_SIZE) {
    const page = await deps.securitiesGateway.getSecurityList(SECURITIES_PAGE_SIZE, offset);
    if (page.entries.some((entry) => entry.symbol === symbol)) {
      return true;
    }
    if (offset + page.entries.length >= page.count || page.entries.length === 0) {
      return false;
    }
  }
}

/**
 * Shared by the holdings/transactions/watchlist route handlers (業務中台) to confirm a symbol is real
 * before creating a row for it — kept on this side (bff) rather than called from inside those domains'
 * own services, since checking against a live quote is a call into this BFF's pass-through data, not
 * something the owning domain's CRUD service should reach across module boundaries for itself.
 *
 * This is the one function in the slice that earns its layer: it turns the gateway's "no such symbol"
 * null into a 404 with a specific message, which is a decision, not a relay. Note the message differs
 * from GET /stocks/:symbol's own 404 ("No stock data found for symbol ...") — that one answers "we have
 * nothing to show you", this one answers "you may not store this". Don't merge them.
 *
 * **2026-10-05：這個守衛原本問錯了問題。** 它只查報價，而上游的報價先查公司檔案，ETF 與特別股沒有那一列
 * ——所以 0050／0056／00878／1312A 全部被擋成 404，而那幾檔正是退休族最常持有的。它要問的是「這個代號
 * 存不存在」，不是「它有沒有普通股報價」。
 *
 * 修法是兩段：報價命中就結束（2,722 檔裡 2,349 是普通股，一次呼叫），查不到才去查有價證券總表。
 * **刻意不直接改成只查總表**，因為那會讓每一筆寫入都付 3 次上游呼叫的代價，而 86% 的情況用一次就夠。
 *
 * **刻意不用「有沒有收盤價」來判斷存在**：`getLatestClosePrices` 對 ETF 與特別股都有值，看起來是更便宜的
 * 修法，但它會擋掉沒有成交的真代號——興櫃、上市第一天、暫停交易。持股管理尤其不能這樣擋：**人會持有
 * 暫停交易的股票**。web-nuxt 2026-10-01 在興櫃頁踩過同一個坑，他們的修法也是改成「查存在」而不是「查價格」。
 */
export async function assertSymbolExists(symbol: string, deps: StockProxyDeps): Promise<void> {
  if (await deps.stockGateway.getStockQuote(symbol)) {
    return;
  }
  if (await isListedSecurity(symbol, deps)) {
    return;
  }
  throw new AppError(`Unknown stock symbol "${symbol}"`, 404);
}
