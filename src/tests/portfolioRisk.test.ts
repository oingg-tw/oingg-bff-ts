import { describe, expect, it } from "vitest";
import { computePortfolioRisk, type PortfolioRiskInput } from "@/domain/portfolioRisk.js";

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
