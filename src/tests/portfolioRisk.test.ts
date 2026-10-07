import { describe, expect, it } from "vitest";
import { computePortfolioRisk, concentration, sectorAllocation, type PortfolioRiskInput } from "@/domain/portfolioRisk.js";

/**
 * 都是不變量：一個寫錯的風險公式算出來的數字看起來一樣合理，所以每一條都是這些指標的定義性質。
 */
const BASE = "2026-03-01";
const CALENDAR = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-09"];
const MARKET = [100, 102, 99, 104, 101, 105, 103]; // BASE + 6 個交易日

function series(values: readonly number[], dates = [BASE, ...CALENDAR]): Map<string, number> {
  return new Map(values.map((v, i) => [dates[i]!, v]));
}

function input(overrides: Partial<PortfolioRiskInput>): PortfolioRiskInput {
  return {
    weights: new Map([["A", 1]]),
    calendar: CALENDAR,
    baseDate: BASE,
    closes: new Map(),
    stockDividends: new Map(),
    marketCloses: series(MARKET),
    ...overrides,
  };
}

describe("computePortfolioRisk — 不變量", () => {
  it("a holding identical to the market has beta 1, correlation 1 and the market's volatility", () => {
    const risk = computePortfolioRisk(input({ closes: new Map([["A", series(MARKET)]]) }));

    expect(risk.tradingDays).toBe(6);
    expect(risk.portfolio.beta).toBeCloseTo(1, 12);
    expect(risk.portfolio.correlation).toBeCloseTo(1, 12);
    expect(risk.portfolio.annualizedVolatility).toBeCloseTo(risk.benchmark.annualizedVolatility!, 12);
    expect(risk.portfolio.maxDrawdown).toEqual(risk.benchmark.maxDrawdown);
  });

  it("a holding that moves exactly twice the market each day has beta 2 and twice the volatility", () => {
    const doubled = [100];
    for (let i = 1; i < MARKET.length; i++) {
      doubled.push(doubled[i - 1]! * (1 + 2 * (MARKET[i]! / MARKET[i - 1]! - 1)));
    }
    const risk = computePortfolioRisk(input({ closes: new Map([["A", series(doubled)]]) }));

    expect(risk.portfolio.beta).toBeCloseTo(2, 10);
    expect(risk.portfolio.correlation).toBeCloseTo(1, 10);
    expect(risk.portfolio.annualizedVolatility! / risk.benchmark.annualizedVolatility!).toBeCloseTo(2, 10);
  });

  it("weights the holdings' daily returns", () => {
    // A 每天 +1%、B 每天 −1%，各半 → 組合每天 0，沒有波動。
    const up = [100, 101, 102.01, 103.0301, 104.060401, 105.10100501, 106.1520150601];
    const down = [100, 99, 98.01, 97.0299, 96.059601, 95.09900499, 94.1480149401];
    const risk = computePortfolioRisk(
      input({ weights: new Map([["A", 0.5], ["B", 0.5]]), closes: new Map([["A", series(up)], ["B", series(down)]]) }),
    );

    expect(risk.portfolio.annualizedVolatility).toBeCloseTo(0, 10);
    expect(risk.portfolio.maxDrawdown.depth).toBeCloseTo(0, 10);
  });
});

describe("computePortfolioRisk — 除權與資料缺口", () => {
  /** 5314 那種：除權當天股價依配股比例掉下來，但股數同時變多，那不是虧損。 */
  it("restores an ex-rights drop so it is not a crash", () => {
    const flat = [60, 60, 60, 60 / 4.157, 60 / 4.157, 60 / 4.157, 60 / 4.157];
    const risk = computePortfolioRisk(
      input({ closes: new Map([["A", series(flat)]]), stockDividends: new Map([["A", [["2026-03-04", 3.157]]]]) }),
    );

    expect(risk.portfolio.annualizedVolatility).toBeCloseTo(0, 10);
    expect(risk.portfolio.maxDrawdown.depth).toBeCloseTo(0, 10);
  });

  it("carries the restore to the next real close when the ex-rights day had no trade", () => {
    const closes = new Map([[BASE, 60], ["2026-03-02", 60], ["2026-03-03", 60], ["2026-03-05", 30], ["2026-03-06", 30], ["2026-03-09", 30]]);
    const risk = computePortfolioRisk(
      input({ closes: new Map([["A", closes]]), stockDividends: new Map([["A", [["2026-03-04", 1]]]]) }),
    );

    expect(risk.portfolio.maxDrawdown.depth).toBeCloseTo(0, 10);
  });

  it("leaves a holding out until it has a price, and says so", () => {
    const late = new Map([["2026-03-05", 50], ["2026-03-06", 51], ["2026-03-09", 52]]);
    const risk = computePortfolioRisk(
      input({ weights: new Map([["A", 0.5], ["B", 0.5]]), closes: new Map([["A", series(MARKET)], ["B", late]]) }),
    );

    expect(risk.coverage.get("A")).toEqual({ kind: "full" });
    expect(risk.coverage.get("B")).toEqual({ kind: "partial", firstPriceDate: "2026-03-05" });
    expect(risk.tradingDays).toBe(6);
  });

  it("returns nulls rather than numbers when there is not enough data", () => {
    const risk = computePortfolioRisk(input({ calendar: ["2026-03-02"], closes: new Map([["A", series([100, 101])]]) }));

    expect(risk.tradingDays).toBe(1);
    expect(risk.portfolio.annualizedVolatility).toBeNull();
    expect(risk.portfolio.beta).toBeNull();
  });
});

describe("max drawdown", () => {
  // +10% → −20% → +30%：前高在第一天，谷底在第二天（−20%），第三天 1.1×0.8×1.3 = 1.144 ≥ 1.1 回到前高。
  it("finds the deepest fall and the day it recovered", () => {
    const path = [100, 110, 88, 114.4, 110, 112, 113];
    const risk = computePortfolioRisk(input({ closes: new Map([["A", series(path)]]) }));

    expect(risk.portfolio.maxDrawdown).toEqual({ depth: expect.closeTo(-0.2, 10), peakDate: "2026-03-02", troughDate: "2026-03-03", recoveryDate: "2026-03-04" });
  });

  it("counts the starting point as a peak when the very first day falls", () => {
    const path = [100, 90, 95, 96, 97, 98, 99];
    const risk = computePortfolioRisk(input({ closes: new Map([["A", series(path)]]) }));

    expect(risk.portfolio.maxDrawdown).toMatchObject({ peakDate: BASE, troughDate: "2026-03-02", recoveryDate: null });
  });
});

/**
 * 2026-10-07 第一批：集中度、風險貢獻、分散化比率、下行與尾端風險。一樣只測定義性質。
 */
describe("concentration", () => {
  it("four equal holdings are effectively four, with the top three at 75%", () => {
    expect(concentration([1, 1, 1, 1])).toEqual({ hhi: 0.25, effectiveHoldings: 4, topThreeWeight: 0.75 });
  });

  // 研究文件的例子：50 檔，前三大各 25%，其餘 47 檔平分 25% → 有效持股數約 5.3。
  it("sees through nominal diversification", () => {
    const shares = concentration([0.25, 0.25, 0.25, ...Array.from({ length: 47 }, () => 0.25 / 47)])!;

    expect(shares.effectiveHoldings).toBeCloseTo(1 / (3 * 0.0625 + 47 * (0.25 / 47) ** 2), 9);
    expect(shares.effectiveHoldings).toBeLessThan(6);
  });
});

describe("risk contributions and diversification", () => {
  const B_PRICES = [50, 49, 51, 50.5, 52, 51, 53];

  it("risk contributions add up to 1", () => {
    const risk = computePortfolioRisk(
      input({ weights: new Map([["A", 0.7], ["B", 0.3]]), closes: new Map([["A", series(MARKET)], ["B", series(B_PRICES)]]) }),
    );

    expect(risk.riskContributions.get("A")! + risk.riskContributions.get("B")!).toBeCloseTo(1, 12);
  });

  // 兩檔走勢一模一樣：完全相關，分散沒有省掉任何波動，風險貢獻就等於權重。
  it("identical holdings: contribution equals weight and the diversification ratio is 1", () => {
    const risk = computePortfolioRisk(
      input({ weights: new Map([["A", 0.7], ["B", 0.3]]), closes: new Map([["A", series(MARKET)], ["B", series(MARKET)]]) }),
    );

    expect(risk.riskContributions.get("A")).toBeCloseTo(0.7, 12);
    expect(risk.diversificationRatio).toBeCloseTo(1, 12);
  });

  it("imperfectly correlated holdings have a diversification ratio above 1", () => {
    const risk = computePortfolioRisk(
      input({ weights: new Map([["A", 0.5], ["B", 0.5]]), closes: new Map([["A", series(MARKET)], ["B", series(B_PRICES)]]) }),
    );

    expect(risk.diversificationRatio!).toBeGreaterThan(1);
  });
});

describe("downside and tail risk", () => {
  it("a series that only rises has no downside deviation and no ulcer", () => {
    const up = [100, 101, 102.01, 103.0301, 104.060401, 105.10100501, 106.1520150601];
    const risk = computePortfolioRisk(input({ closes: new Map([["A", series(up)]]) }));

    expect(risk.portfolio.downsideDeviation).toBe(0);
    expect(risk.portfolio.ulcerIndex).toBe(0);
  });

  // 6 筆日報酬的 5% 尾巴是 ⌈0.3⌉ = 1 筆，所以 VaR 與 CVaR 都等於最差的那一天。
  it("historical VaR and CVaR come from the actual worst days", () => {
    const risk = computePortfolioRisk(input({ closes: new Map([["A", series(MARKET)]]) }));
    const worst = Math.min(...MARKET.slice(1).map((v, i) => v / MARKET[i]! - 1));

    expect(risk.portfolio.valueAtRisk95).toBeCloseTo(worst, 12);
    expect(risk.portfolio.expectedShortfall95).toBeCloseTo(worst, 12);
  });

  // 潰瘍指數 ≥ |最大回撤| ÷ √n 且 ≤ |最大回撤|：均方根介於「只有最深那天」與「每天都那麼深」之間。
  it("the ulcer index sits between the deepest drawdown spread over every day and the deepest drawdown itself", () => {
    const risk = computePortfolioRisk(input({ closes: new Map([["A", series(MARKET)]]) }));
    const depth = Math.abs(risk.portfolio.maxDrawdown.depth);

    expect(risk.portfolio.ulcerIndex!).toBeLessThanOrEqual(depth);
    expect(risk.portfolio.ulcerIndex!).toBeGreaterThanOrEqual(depth / Math.sqrt(risk.tradingDays));
  });
});

/** 2026-10-07：類股配置、相關係數矩陣、回推期間報酬（壓力情境用）。 */
describe("sectorAllocation", () => {
  it("adds weights per sector and keeps unclassified holdings as their own group", () => {
    const result = sectorAllocation(
      new Map([["A", 0.5], ["B", 0.3], ["C", 0.2]]),
      new Map([["A", { sectorCode: "24", sectorName: "半導體業" }], ["B", { sectorCode: "24", sectorName: "半導體業" }]]),
    );

    expect(result.sectors.map((s) => [s.sectorCode, s.weight, s.symbols])).toEqual([["24", 0.8, ["A", "B"]], [null, 0.2, ["C"]]]);
    expect(result.effectiveSectors).toBeCloseTo(1 / (0.8 ** 2 + 0.2 ** 2), 12);
  });
});

describe("correlations and period return", () => {
  it("identical holdings correlate at exactly 1 and the matrix is symmetric", () => {
    const risk = computePortfolioRisk(
      input({ weights: new Map([["A", 0.7], ["B", 0.3]]), closes: new Map([["A", series(MARKET)], ["B", series(MARKET)]]) }),
    );

    expect(risk.correlations.symbols).toEqual(["A", "B"]);
    expect(risk.correlations.matrix[0]![1]).toBeCloseTo(1, 12);
    expect(risk.correlations.matrix[1]![0]).toBe(risk.correlations.matrix[0]![1]);
  });

  it("the period return of a holding identical to the market is the market's own return", () => {
    const risk = computePortfolioRisk(input({ closes: new Map([["A", series(MARKET)]]) }));

    expect(risk.periodReturn.portfolio).toBeCloseTo(MARKET.at(-1)! / MARKET[0]! - 1, 12);
    expect(risk.periodReturn.benchmark).toBeCloseTo(MARKET.at(-1)! / MARKET[0]! - 1, 12);
  });
});

describe("holding contributions", () => {
  // 逐日歸因的定義性質：各檔貢獻加起來剛好等於組合的期間報酬——連期中才有股價（權重重新分配）的情況也一樣。
  it("contributions add up exactly to the portfolio's period return, even with a late listing", () => {
    const late = [NaN, NaN, NaN, 30, 31, 29, 33];
    const closesB = new Map(late.flatMap((v, i) => (Number.isNaN(v) ? [] : [[[BASE, ...CALENDAR][i]!, v] as const])));
    const risk = computePortfolioRisk(
      input({ weights: new Map([["A", 0.6], ["B", 0.4]]), closes: new Map([["A", series(MARKET)], ["B", closesB]]) }),
    );
    const total = [...risk.holdingReturns.values()].reduce((sum, h) => sum + h.contribution, 0);

    expect(total).toBeCloseTo(risk.periodReturn.portfolio!, 12);
    expect(risk.holdingReturns.get("A")!.periodReturn).toBeCloseTo(MARKET.at(-1)! / MARKET[0]! - 1, 12);
    expect(risk.holdingReturns.get("B")!.periodReturn).toBeCloseTo(33 / 30 - 1, 12);
  });
});
