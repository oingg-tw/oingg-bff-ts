import { projectHoldings } from "@/domain/holdingProjection.js";
import { computePortfolioRisk, concentration, portfolioFundamentals, sectorAllocation, type DistributionRisk, type Drawdown } from "@/domain/portfolioRisk.js";
import { sectorDirectory } from "@/application/holdings/sectorDirectory.js";
import { logger } from "@/shared/logger.js";
import { toLedgerEntry } from "@/application/transactions/transactions.service.js";
import { applyStockDividends, stockDividendEventsFor } from "@/application/holdings/stockDividendLedger.js";
import { fetchCloses, resolveTradingWindow } from "@/application/holdings/marketWindow.js";
import type { AppDeps } from "@/application/deps.js";
import type { DistributionRiskView, DrawdownView, PortfolioRiskReport, StressScenariosReport } from "@/application/holdings/holdings.types.js";

/**
 * GET /holdings/risk 的編排：現在的持股（含自動配股、FIFO）→ 用最新收盤價算市值權重 → 抓期間的收盤價與
 * 除權比例 → domain 算風險。跟 /holdings/performance 共用期間與收盤價的取得（marketWindow.ts）。
 */
export type HoldingsRiskDeps = Pick<AppDeps, "transactions" | "stockGateway" | "marketGateway" | "screenerGateway">;

const DECIMALS = 6;

/**
 * 樣本太少就不給的門檻（呈現規則，數學在 domain/portfolioRisk.ts）。尾端：95% 的尾巴在 100 天裡只有 5 筆，
 * 再少就是一兩筆的極端值在說話。共變異數類（風險貢獻、分散化比率）：跟 beta 一樣，約 120 天以下估不穩。
 */
const MIN_DAYS_FOR_TAIL = 100;
const MIN_DAYS_FOR_COVARIANCE = 120;

function fixed(value: number | null): string | null {
  return value === null ? null : value.toFixed(DECIMALS);
}

function distributionView(risk: DistributionRisk, tradingDays: number): DistributionRiskView {
  const tailOk = tradingDays >= MIN_DAYS_FOR_TAIL;
  return {
    downsideDeviation: fixed(risk.downsideDeviation),
    ulcerIndex: fixed(risk.ulcerIndex),
    valueAtRisk95: tailOk ? fixed(risk.valueAtRisk95) : null,
    expectedShortfall95: tailOk ? fixed(risk.expectedShortfall95) : null,
  };
}

/** 這三個欄位一次向選股器要。近 12 個月每股股利、交易所公布的本益比與股價淨值比。 */
const FUNDAMENTAL_FIELDS = { dividend: "liveDividendPerShare.EOD", pe: "exchangePeRatio.EOD", pb: "exchangePbRatio.EOD" } as const;

function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * 類股與基本面都是附加資訊：上游取不到時只讓那一組是 null，不讓整支風險端點失敗（跟 /holdings/performance
 * 的無風險利率同一個取捨）。
 */
async function optional<T>(label: string, work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    logger.warn({ err: error }, `${label} unavailable — /holdings/risk returns it as null`);
    return null;
  }
}

/**
 * 權重 ＝ 股數 × 最新收盤價（「現在」的市值比例，跟期間的 to 無關——回推的是現在這組持股）。
 * 完全沒有收盤價的那一檔沒有市值可算，不在 weights 裡。
 */
function currentWeights(held: readonly { symbol: string; quantity: number }[], closes: ReadonlyMap<string, ReadonlyMap<string, number>>) {
  const latestDates: string[] = [];
  const marketValues = new Map<string, number>();
  for (const position of held) {
    const latest = [...(closes.get(position.symbol) ?? new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)).at(-1);
    if (latest) {
      marketValues.set(position.symbol, position.quantity * latest[1]);
      latestDates.push(latest[0]);
    }
  }
  const totalValue = [...marketValues.values()].reduce((sum, value) => sum + value, 0);
  const weights = new Map(totalValue > 0 ? [...marketValues].map(([symbol, value]) => [symbol, value / totalValue] as const) : []);
  return { marketValues, weightsAsOf: latestDates.sort().at(-1) ?? null, totalValue, weights };
}

function stockDividendsBySymbol(events: readonly { symbol: string; exRightsDate: string; sharesPerShare: number }[]) {
  const bySymbol = new Map<string, [string, number][]>();
  for (const event of events) {
    bySymbol.set(event.symbol, [...(bySymbol.get(event.symbol) ?? []), [event.exRightsDate, event.sharesPerShare]]);
  }
  return bySymbol;
}

function amount(fraction: string | null, marketValue: number): string | null {
  return fraction === null ? null : (Number(fraction) * marketValue).toFixed(0);
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
  const noDistribution: DistributionRiskView = { downsideDeviation: null, ulcerIndex: null, valueAtRisk95: null, expectedShortfall95: null };
  const empty: PortfolioRiskReport = {
    from: window.from,
    to: window.to,
    tradingDays: 0,
    weightsAsOf: null,
    marketValue: null,
    portfolio: {
      annualizedVolatility: null,
      beta: null,
      correlation: null,
      maxDrawdown: flat,
      valueAtRisk95Amount: null,
      expectedShortfall95Amount: null,
      ...noDistribution,
    },
    benchmark: { annualizedVolatility: null, maxDrawdown: flat, ...noDistribution },
    concentration: null,
    diversificationRatio: null,
    holdings: [],
    sectors: null,
    fundamentals: null,
    correlations: null,
  };

  // 現在的持股：跟 GET /holdings 同一套重算（含自動配股），只是要的是股數不是格式化後的字串。
  const { entries } = await applyStockDividends((await deps.transactions.list(firebaseUid)).map(toLedgerEntry), deps);
  const held = projectHoldings(entries).holdings.filter((position) => position.quantity > 0);
  if (!window.baseDate || held.length === 0) {
    return empty;
  }

  const symbols = held.map((position) => position.symbol);
  const [closes, events, directory, values] = await Promise.all([
    fetchCloses(symbols, window.tradingDaysNeeded, deps),
    stockDividendEventsFor(new Set(symbols), window.baseDate, deps),
    optional("Sector directory", sectorDirectory(deps)),
    optional(
      "Holding fundamentals",
      deps.screenerGateway.getValues(symbols, Object.values(FUNDAMENTAL_FIELDS).map((field) => ({ field }))),
    ),
  ]);

  const { marketValues, weightsAsOf, totalValue, weights } = currentWeights(held, closes);
  if (totalValue <= 0) {
    return { ...empty, holdings: symbols.map((symbol) => ({ symbol, weight: null, coverage: "none", firstPriceDate: null, riskContribution: null })) };
  }
  const stockDividends = stockDividendsBySymbol(events);

  const risk = computePortfolioRisk({
    weights,
    calendar: window.calendar,
    baseDate: window.baseDate,
    closes,
    stockDividends,
    marketCloses: window.taiexCloses,
  });

  const covarianceOk = risk.tradingDays >= MIN_DAYS_FOR_COVARIANCE;
  const sectors = directory && sectorAllocation(weights, directory);
  const valuesBySymbol = new Map((values?.results ?? []).map((row) => [row.symbol, row.values]));
  const fundamentals =
    values &&
    portfolioFundamentals(
      held.flatMap((position) => {
        const marketValue = marketValues.get(position.symbol);
        if (marketValue === undefined) {
          return [];
        }
        const v = valuesBySymbol.get(position.symbol) ?? {};
        return [
          {
            quantity: position.quantity,
            marketValue,
            dividendPerShare: toNumber(v[FUNDAMENTAL_FIELDS.dividend]?.value),
            peRatio: toNumber(v[FUNDAMENTAL_FIELDS.pe]?.value),
            pbRatio: toNumber(v[FUNDAMENTAL_FIELDS.pb]?.value),
          },
        ];
      }),
    );
  const portfolioDistribution = distributionView(risk.portfolio, risk.tradingDays);
  const shares = concentration([...weights.values()]);
  return {
    from: window.from,
    to: window.to,
    tradingDays: risk.tradingDays,
    weightsAsOf,
    marketValue: totalValue.toFixed(0),
    portfolio: {
      annualizedVolatility: fixed(risk.portfolio.annualizedVolatility),
      beta: fixed(risk.portfolio.beta),
      correlation: fixed(risk.portfolio.correlation),
      maxDrawdown: drawdownView(risk.portfolio.maxDrawdown),
      ...portfolioDistribution,
      valueAtRisk95Amount: amount(portfolioDistribution.valueAtRisk95, totalValue),
      expectedShortfall95Amount: amount(portfolioDistribution.expectedShortfall95, totalValue),
    },
    benchmark: {
      annualizedVolatility: fixed(risk.benchmark.annualizedVolatility),
      maxDrawdown: drawdownView(risk.benchmark.maxDrawdown),
      ...distributionView(risk.benchmark, risk.tradingDays),
    },
    concentration: shares && {
      hhi: shares.hhi.toFixed(DECIMALS),
      effectiveHoldings: shares.effectiveHoldings.toFixed(DECIMALS),
      topThreeWeight: shares.topThreeWeight.toFixed(DECIMALS),
    },
    diversificationRatio: covarianceOk ? fixed(risk.diversificationRatio) : null,
    sectors: sectors && {
      effectiveSectors: fixed(sectors.effectiveSectors),
      groups: sectors.sectors.map((group) => ({ ...group, weight: group.weight.toFixed(DECIMALS) })),
    },
    fundamentals: fundamentals && {
      dividendIncome: fundamentals.dividendIncome === null ? null : fundamentals.dividendIncome.toFixed(0),
      dividendYield: fixed(fundamentals.dividendYield),
      dividendCoverage: fundamentals.dividendCoverage.toFixed(DECIMALS),
      peRatio: fixed(fundamentals.peRatio),
      peCoverage: fundamentals.peCoverage.toFixed(DECIMALS),
      pbRatio: fixed(fundamentals.pbRatio),
      pbCoverage: fundamentals.pbCoverage.toFixed(DECIMALS),
    },
    correlations: covarianceOk
      ? { symbols: risk.correlations.symbols, matrix: risk.correlations.matrix.map((row) => row.map((value) => fixed(value))) }
      : null,
    holdings: symbols
      .map((symbol) => {
        const coverage = risk.coverage.get(symbol);
        const weight = weights.get(symbol);
        const contribution = risk.riskContributions.get(symbol);
        return {
          symbol,
          weight: weight === undefined ? null : weight.toFixed(DECIMALS),
          coverage: coverage?.kind ?? ("none" as const),
          firstPriceDate: coverage?.kind === "partial" ? coverage.firstPriceDate : null,
          riskContribution: covarianceOk && contribution !== undefined ? contribution.toFixed(DECIMALS) : null,
        };
      })
      .sort((a, b) => Number(b.weight ?? -1) - Number(a.weight ?? -1)),
  };
}

/**
 * 歷史壓力情境（2026-10-07，使用者要求）。每一段是加權指數從高點到低點，日期是 2026-10-07 從加權指數
 * 收盤實際找出來的（在大致的區間裡取最高收盤與它之後的最低收盤），不是憑印象寫的。
 *
 * 2018 年的貿易戰不列：個股股價只回溯約 2000 個交易日，配股行事曆也只從 2019 年起有資料，還原不了。
 * 隨著時間過去，最早那段也會超出股價能回溯的深度——那時它回 available: false，不是錯誤。
 */
const STRESS_SCENARIOS = [
  { key: "covid-2020", name: "2020 新冠疫情", peakDate: "2020-01-14", troughDate: "2020-03-19" },
  { key: "rate-hikes-2022", name: "2022 升息熊市", peakDate: "2022-01-04", troughDate: "2022-10-25" },
  { key: "yen-carry-2024", name: "2024 日圓套利平倉", peakDate: "2024-07-11", troughDate: "2024-08-05" },
  { key: "tariffs-2025", name: "2025 關稅衝擊", peakDate: "2025-02-21", troughDate: "2025-04-09" },
] as const;

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * 用現在的持股回推每一段大跌：權重跟 /holdings/risk 一樣（股數 × 最新收盤），除權一樣還原。期間是
 * (高點, 低點]，起點是高點那天的收盤。
 */
export async function getStressScenarios(firebaseUid: string, deps: HoldingsRiskDeps): Promise<StressScenariosReport> {
  const { entries } = await applyStockDividends((await deps.transactions.list(firebaseUid)).map(toLedgerEntry), deps);
  const held = projectHoldings(entries).holdings.filter((position) => position.quantity > 0);
  const symbols = held.map((position) => position.symbol);
  const unavailable = (scenario: (typeof STRESS_SCENARIOS)[number]) => ({
    ...scenario,
    available: false,
    portfolio: { periodReturn: null, maxDrawdown: null },
    benchmark: { periodReturn: null },
    coveredWeight: null,
    notCovered: [],
  });
  if (held.length === 0) {
    return { weightsAsOf: null, scenarios: STRESS_SCENARIOS.map(unavailable) };
  }

  // 權重只需要最新收盤：抓最近一小段就好（快取會被後面更長的那幾段覆蓋成超集）。
  const { weights, weightsAsOf, totalValue } = currentWeights(held, await fetchCloses(symbols, 30, deps));
  if (totalValue <= 0) {
    return { weightsAsOf, scenarios: STRESS_SCENARIOS.map(unavailable) };
  }

  const scenarios: StressScenariosReport["scenarios"] = [];
  for (const scenario of STRESS_SCENARIOS) {
    let window: Awaited<ReturnType<typeof resolveTradingWindow>>;
    try {
      window = await resolveTradingWindow(nextDay(scenario.peakDate), scenario.troughDate, deps);
    } catch {
      // 比股價能回溯的深度還早：resolveTradingWindow 回 400。這裡不是錯誤，只是這一段做不了。
      scenarios.push(unavailable(scenario));
      continue;
    }
    if (!window.baseDate) {
      scenarios.push(unavailable(scenario));
      continue;
    }
    const [closes, events] = await Promise.all([
      fetchCloses(symbols, window.tradingDaysNeeded, deps),
      stockDividendEventsFor(new Set(symbols), window.baseDate, deps),
    ]);
    const risk = computePortfolioRisk({
      weights,
      calendar: window.calendar,
      baseDate: window.baseDate,
      closes,
      stockDividends: stockDividendsBySymbol(events),
      marketCloses: window.taiexCloses,
    });
    const notCovered = [...weights.keys()].flatMap((symbol) => {
      const coverage = risk.coverage.get(symbol);
      if (coverage?.kind === "full") {
        return [];
      }
      return [{ symbol, coverage: coverage?.kind === "partial" ? ("partial" as const) : ("none" as const), firstPriceDate: coverage?.kind === "partial" ? coverage.firstPriceDate : null }];
    });
    const coveredWeight = [...weights].reduce((sum, [symbol, weight]) => (risk.coverage.get(symbol)?.kind === "full" ? sum + weight : sum), 0);
    scenarios.push({
      ...scenario,
      available: true,
      portfolio: { periodReturn: fixed(risk.periodReturn.portfolio), maxDrawdown: risk.portfolio.maxDrawdown.depth.toFixed(DECIMALS) },
      benchmark: { periodReturn: fixed(risk.periodReturn.benchmark) },
      coveredWeight: coveredWeight.toFixed(DECIMALS),
      notCovered,
    });
  }
  return { weightsAsOf, scenarios };
}
