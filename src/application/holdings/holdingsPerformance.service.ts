import { computePortfolioReturn } from "@/domain/portfolioReturn.js";
import { toLedgerEntry } from "@/application/transactions/transactions.service.js";
import { applyStockDividends } from "@/application/holdings/stockDividendLedger.js";
import { fetchCloses, resolveTradingWindow } from "@/application/holdings/marketWindow.js";
import type { AppDeps } from "@/application/deps.js";
import type { PortfolioPerformanceReport } from "@/application/holdings/holdings.types.js";

/**
 * GET /holdings/performance 的編排：決定期間、取交易日曆與收盤價、交給 domain 算 TWR。
 *
 * 這不是代理端點——輸入是這個服務自己擁有的交易紀錄，analysis-ts 只提供公開的收盤價，它不該、也
 * 不會知道任何使用者的持股。所以「衍生計算屬於擁有資料的服務」在這裡指的就是 bff-ts。
 *
 * 期間、交易日曆、收盤價的取得跟 /holdings/risk 共用 marketWindow.ts。
 */
export type HoldingsPerformanceDeps = Pick<AppDeps, "transactions" | "stockGateway" | "marketGateway">;

const RETURN_DECIMALS = 6;

export async function getPortfolioPerformance(
  firebaseUid: string,
  requestedFrom: string | undefined,
  requestedTo: string | undefined,
  deps: HoldingsPerformanceDeps,
): Promise<PortfolioPerformanceReport> {
  const { from, to, calendar, baseDate, tradingDaysNeeded } = await resolveTradingWindow(requestedFrom, requestedTo, deps);
  if (!baseDate) {
    return { from, to, twr: null, series: [], missingPrices: [] };
  }

  // 先補配股再截到 to：配股的股數取決於除權日前的持股，所以要在完整的帳本上算。
  const { entries: withDividends } = await applyStockDividends((await deps.transactions.list(firebaseUid)).map(toLedgerEntry), deps);
  const entries = withDividends.filter((entry) => entry.tradeDate <= to);

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

  // close 為 null 的日子不在 closes 裡，domain 會沿用前一個收盤價並計入 missingPrices。
  const closes = await fetchCloses(symbols, tradingDaysNeeded, deps);
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
