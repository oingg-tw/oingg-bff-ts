import { projectHoldings } from "@/domain/holdingProjection.js";
import { computePortfolioRisk, type Drawdown } from "@/domain/portfolioRisk.js";
import { toLedgerEntry } from "@/application/transactions/transactions.service.js";
import { applyStockDividends, stockDividendEventsFor } from "@/application/holdings/stockDividendLedger.js";
import { fetchCloses, resolveTradingWindow } from "@/application/holdings/marketWindow.js";
import type { AppDeps } from "@/application/deps.js";
import type { DrawdownView, PortfolioRiskReport } from "@/application/holdings/holdings.types.js";

/**
 * GET /holdings/risk 的編排：現在的持股（含自動配股、FIFO）→ 用最新收盤價算市值權重 → 抓期間的收盤價與
 * 除權比例 → domain 算風險。跟 /holdings/performance 共用期間與收盤價的取得（marketWindow.ts）。
 */
export type HoldingsRiskDeps = Pick<AppDeps, "transactions" | "stockGateway" | "marketGateway">;

const DECIMALS = 6;

function fixed(value: number | null): string | null {
  return value === null ? null : value.toFixed(DECIMALS);
}

function drawdownView(drawdown: Drawdown): DrawdownView {
  return { ...drawdown, depth: drawdown.depth.toFixed(DECIMALS) };
}

export async function getPortfolioRisk(
  firebaseUid: string,
  requestedFrom: string | undefined,
  requestedTo: string | undefined,
  deps: HoldingsRiskDeps,
): Promise<PortfolioRiskReport> {
  const window = await resolveTradingWindow(requestedFrom, requestedTo, deps);
  const flat: DrawdownView = { depth: (0).toFixed(DECIMALS), peakDate: null, troughDate: null, recoveryDate: null };
  const empty: PortfolioRiskReport = {
    from: window.from,
    to: window.to,
    tradingDays: 0,
    weightsAsOf: null,
    portfolio: { annualizedVolatility: null, beta: null, correlation: null, maxDrawdown: flat },
    benchmark: { annualizedVolatility: null, maxDrawdown: flat },
    holdings: [],
  };

  // 現在的持股：跟 GET /holdings 同一套重算（含自動配股），只是要的是股數不是格式化後的字串。
  const { entries } = await applyStockDividends((await deps.transactions.list(firebaseUid)).map(toLedgerEntry), deps);
  const held = projectHoldings(entries).holdings.filter((position) => position.quantity > 0);
  if (!window.baseDate || held.length === 0) {
    return empty;
  }

  const symbols = held.map((position) => position.symbol);
  const [closes, events] = await Promise.all([
    fetchCloses(symbols, window.tradingDaysNeeded, deps),
    stockDividendEventsFor(new Set(symbols), window.baseDate, deps),
  ]);

  // 權重 ＝ 股數 × 最新收盤價（「現在」的市值比例，跟期間的 to 無關——回推的是現在這組持股）。
  // 完全沒有收盤價的那一檔沒有市值可算，權重是 null、不參與。
  const latestDates: string[] = [];
  const marketValues = new Map<string, number>();
  for (const position of held) {
    const latest = [...(closes.get(position.symbol) ?? new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)).at(-1);
    if (latest) {
      marketValues.set(position.symbol, position.quantity * latest[1]);
      latestDates.push(latest[0]);
    }
  }
  const weightsAsOf = latestDates.sort().at(-1) ?? null;
  const totalValue = [...marketValues.values()].reduce((sum, value) => sum + value, 0);
  if (totalValue <= 0) {
    return { ...empty, holdings: symbols.map((symbol) => ({ symbol, weight: null, coverage: "none", firstPriceDate: null })) };
  }
  const weights = new Map([...marketValues].map(([symbol, value]) => [symbol, value / totalValue]));

  const stockDividends = new Map<string, [string, number][]>();
  for (const event of events) {
    stockDividends.set(event.symbol, [...(stockDividends.get(event.symbol) ?? []), [event.exRightsDate, event.sharesPerShare]]);
  }

  const risk = computePortfolioRisk({
    weights,
    calendar: window.calendar,
    baseDate: window.baseDate,
    closes,
    stockDividends,
    marketCloses: window.taiexCloses,
  });

  return {
    from: window.from,
    to: window.to,
    tradingDays: risk.tradingDays,
    weightsAsOf,
    portfolio: {
      annualizedVolatility: fixed(risk.portfolio.annualizedVolatility),
      beta: fixed(risk.portfolio.beta),
      correlation: fixed(risk.portfolio.correlation),
      maxDrawdown: drawdownView(risk.portfolio.maxDrawdown),
    },
    benchmark: {
      annualizedVolatility: fixed(risk.benchmark.annualizedVolatility),
      maxDrawdown: drawdownView(risk.benchmark.maxDrawdown),
    },
    holdings: symbols
      .map((symbol) => {
        const coverage = risk.coverage.get(symbol);
        const weight = weights.get(symbol);
        return {
          symbol,
          weight: weight === undefined ? null : weight.toFixed(DECIMALS),
          coverage: coverage?.kind ?? ("none" as const),
          firstPriceDate: coverage?.kind === "partial" ? coverage.firstPriceDate : null,
        };
      })
      .sort((a, b) => Number(b.weight ?? -1) - Number(a.weight ?? -1)),
  };
}
