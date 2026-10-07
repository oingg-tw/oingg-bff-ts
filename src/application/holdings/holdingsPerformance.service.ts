import { compareWithBenchmark, computePortfolioReturn, dailyRiskFreeRates, riskAdjustedReturns } from "@/domain/portfolioReturn.js";
import { logger } from "@/shared/logger.js";
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
export type HoldingsPerformanceDeps = Pick<AppDeps, "transactions" | "stockGateway" | "marketGateway" | "macroGateway">;

const RETURN_DECIMALS = 6;
/** 捕獲率與 Omega 的最低樣本（呈現規則）：跟 beta 一樣，約 120 個交易日以下估不穩。 */
const MIN_DAYS_FOR_COMPARISON = 120;
const MS_PER_DAY = 86_400_000;

function fixed(value: number | null): string | null {
  return value === null ? null : value.toFixed(RETURN_DECIMALS);
}

function annualize(periodReturn: number | null, days: number): string | null {
  return periodReturn === null || days < 365 ? null : fixed((1 + periodReturn) ** (365 / days) - 1);
}

function emptyRiskAdjusted(sampleDays: number): PortfolioPerformanceReport["riskAdjusted"] {
  return { sampleDays, sharpe: null, sortino: null, calmar: null, m2: null, beta: null, jensenAlpha: null, trackingError: null, informationRatio: null };
}

/**
 * 無風險利率的月資料。**取不到不讓整支端點失敗**：它只影響 riskAdjusted 那一組，其他欄位照常回傳，
 * 所以這裡吞掉錯誤、記一筆 warn、回 null。
 */
async function riskFreeMonthly(fromPeriod: string, deps: HoldingsPerformanceDeps) {
  try {
    const result = await deps.macroGateway.getFiveMajorBankRate(fromPeriod);
    const monthly = result.entries.flatMap((entry) =>
      entry.depositRate1yPct === null ? [] : [{ period: entry.period, annualPct: entry.depositRate1yPct }],
    );
    return monthly.length > 0 ? { latestPeriod: result.latestPeriod, monthly } : null;
  } catch (error) {
    logger.warn({ err: error }, "Risk-free rate unavailable — /holdings/performance returns riskAdjusted as nulls");
    return null;
  }
}

export async function getPortfolioPerformance(
  firebaseUid: string,
  requestedFrom: string | undefined,
  requestedTo: string | undefined,
  deps: HoldingsPerformanceDeps,
): Promise<PortfolioPerformanceReport> {
  const { from, to, calendar, baseDate, tradingDaysNeeded, taiexCloses } = await resolveTradingWindow(requestedFrom, requestedTo, deps);
  if (!baseDate) {
    return {
      from,
      to,
      twr: null,
      series: [],
      missingPrices: [],
      mwr: null,
      annualized: { twr: null, mwr: null },
      trading: { buyAmount: "0", sellAmount: "0", fees: "0", taxes: "0", averageMarketValue: null, turnover: null, costRatio: null },
      benchmarkComparison: { sampleDays: 0, upCapture: null, downCapture: null, omega: null },
      riskAdjusted: emptyRiskAdjusted(0),
      riskFree: null,
    };
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
  // 往前多抓一年：期間開始那個月可能還沒有資料，要能沿用更早的月份。先發出去，跟下面的計算重疊。
  const riskFreePending = riskFreeMonthly(`${Number(baseDate.slice(0, 4)) - 1}${baseDate.slice(4, 7)}`, deps);
  const result = computePortfolioReturn({ entries, calendar, baseDate, closes });
  const riskFreeSource = await riskFreePending;
  const comparison = compareWithBenchmark(result.dailyReturns, taiexCloses, calendar, baseDate);
  const comparisonOk = comparison.sampleDays >= MIN_DAYS_FOR_COMPARISON;
  const periodDays = (Date.parse(`${calendar.at(-1)!}T00:00:00Z`) - Date.parse(`${baseDate}T00:00:00Z`)) / MS_PER_DAY;
  const { buyAmount, sellAmount, fees, taxes, averageMarketValue } = result.trading;
  const perAverage = (numerator: number) => (averageMarketValue ? fixed(numerator / averageMarketValue) : null);
  const annualizedTwr = annualize(result.twr, periodDays);

  let riskAdjusted = emptyRiskAdjusted(0);
  let riskFree: PortfolioPerformanceReport["riskFree"] = null;
  if (riskFreeSource) {
    const rates = dailyRiskFreeRates(calendar, riskFreeSource.monthly);
    const adjusted = riskAdjustedReturns(result.dailyReturns, taiexCloses, calendar, baseDate, rates.byDate);
    riskFree = {
      source: "five-major-bank-1y-deposit",
      latestPeriod: riskFreeSource.latestPeriod,
      rates: rates.used.map((rate) => ({ period: rate.period, ratePct: rate.annualPct, sourcePeriod: rate.sourcePeriod })),
    };
    riskAdjusted =
      adjusted.sampleDays < MIN_DAYS_FOR_COMPARISON
        ? emptyRiskAdjusted(adjusted.sampleDays)
        : {
            sampleDays: adjusted.sampleDays,
            sharpe: fixed(adjusted.sharpe),
            sortino: fixed(adjusted.sortino),
            calmar: annualizedTwr !== null && adjusted.maxDrawdown < 0 ? fixed(Number(annualizedTwr) / Math.abs(adjusted.maxDrawdown)) : null,
            m2: fixed(adjusted.m2),
            beta: fixed(adjusted.beta),
            jensenAlpha: fixed(adjusted.jensenAlpha),
            trackingError: fixed(adjusted.trackingError),
            informationRatio: fixed(adjusted.informationRatio),
          };
  }

  return {
    from,
    to,
    twr: fixed(result.twr),
    mwr: fixed(result.mwr),
    annualized: { twr: annualizedTwr, mwr: annualize(result.mwr, periodDays) },
    trading: {
      buyAmount: buyAmount.toFixed(0),
      sellAmount: sellAmount.toFixed(0),
      fees: fees.toFixed(0),
      taxes: taxes.toFixed(0),
      averageMarketValue: averageMarketValue === null ? null : averageMarketValue.toFixed(0),
      turnover: perAverage(Math.min(buyAmount, sellAmount)),
      costRatio: perAverage(fees + taxes),
    },
    benchmarkComparison: {
      sampleDays: comparison.sampleDays,
      upCapture: comparisonOk ? fixed(comparison.upCapture) : null,
      downCapture: comparisonOk ? fixed(comparison.downCapture) : null,
      omega: comparisonOk ? fixed(comparison.omega) : null,
    },
    riskAdjusted,
    riskFree,
    series: result.series.map((point) => ({
      date: point.date,
      cumulative: point.cumulative === null ? null : point.cumulative.toFixed(RETURN_DECIMALS),
    })),
    missingPrices: [...result.missingPriceDays]
      .map(([symbol, dates]) => ({ symbol, dates }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}
