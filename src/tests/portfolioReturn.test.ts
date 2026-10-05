import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "@/domain/holdingProjection.js";
import { computePortfolioReturn } from "@/domain/portfolioReturn.js";

/**
 * 這裡的測試刻意都是**不變量**，而不是「算出來是 0.1234」：一個寫錯的報酬率公式算出來的數字看起來
 * 一樣合理。每一條都是 TWR 本身的定義性質，公式錯了就一定有一條會斷。
 */
let seq = 0;
function trade(symbol: string, action: "BUY" | "SELL", quantity: number, price: number, tradeDate: string, fee = 0, tax = 0): LedgerEntry {
  return { symbol, action, quantity, price, fee, tax, tradeDate, createdAt: `2026-01-01T00:00:00.${String(seq++).padStart(3, "0")}Z` };
}

const BASE = "2026-03-01";
const CALENDAR = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"];
const A_CLOSES: [string, number][] = [[BASE, 100], ["2026-03-02", 102], ["2026-03-03", 99], ["2026-03-04", 105], ["2026-03-05", 110], ["2026-03-06", 108]];
const B_CLOSES: [string, number][] = [[BASE, 50], ["2026-03-02", 49], ["2026-03-03", 51], ["2026-03-04", 52], ["2026-03-05", 50], ["2026-03-06", 53]];

function closes(series: Record<string, [string, number][]>) {
  return new Map(Object.entries(series).map(([symbol, rows]) => [symbol, new Map(rows)]));
}
const run = (entries: LedgerEntry[], extra: Record<string, [string, number][]> = {}) =>
  computePortfolioReturn({ entries, calendar: CALENDAR, baseDate: BASE, closes: closes({ A: A_CLOSES, B: B_CLOSES, ...extra }) });

describe("computePortfolioReturn — 不變量", () => {
  it("equals end value / start value − 1 when nothing trades inside the window", () => {
    const result = run([trade("A", "BUY", 300, 90, "2026-02-01"), trade("B", "BUY", 1000, 45, "2026-02-01")]);

    const start = 300 * 100 + 1000 * 50;
    const end = 300 * 108 + 1000 * 53;
    expect(result.twr).toBeCloseTo(end / start - 1, 12);
  });

  /**
   * TWR 的定義性質：單一個股不論怎麼加減碼，報酬都等於那檔股價的漲跌幅。這個公式在「以前一天收盤價
   * 買進、以當天收盤價賣出」時是精確的（見 portfolioReturn.ts 的說明），所以釘在那兩個價格上。
   */
  it("equals the single stock's price change no matter how the position is resized", () => {
    const result = run([
      trade("A", "BUY", 100, 95, "2026-02-01"),
      trade("A", "BUY", 5000, 102, "2026-03-03"), // 前一天（03-02）收盤 102
      trade("A", "SELL", 4000, 105, "2026-03-04"), // 當天收盤 105
      trade("A", "BUY", 777, 105, "2026-03-05"), // 前一天（03-04）收盤 105
    ]);

    expect(result.twr).toBeCloseTo(108 / 100 - 1, 12);
  });

  it("does not depend on position size", () => {
    const entries = [trade("A", "BUY", 100, 95, "2026-02-01"), trade("B", "BUY", 300, 49.5, "2026-03-03", 20), trade("A", "SELL", 50, 104, "2026-03-05", 15, 30)];
    const doubled = entries.map((e) => ({ ...e, quantity: e.quantity * 2, fee: e.fee * 2, tax: e.tax * 2 }));

    expect(run(doubled).twr).toBeCloseTo(run(entries).twr!, 12);
  });

  /**
   * web-nuxt 原本提的 (V_t − CF_t) ÷ V_{t−1} − 1 在這裡會爆：前一天只有 10 股 B（490 元）、當天盤中
   * 以 100 買進 10,000 股 A、收盤 99（−1%）——那個公式的分子是 −10,000、分母 490，單日 −2041%。
   * 這裡的分母包含當天流入，單日報酬應該落在當天那檔的跌幅附近。
   */
  it("keeps a large intraday buy on top of a tiny position bounded", () => {
    const result = run([trade("B", "BUY", 10, 49, "2026-03-02"), trade("A", "BUY", 10_000, 100, "2026-03-03")]);

    const day = result.series.find((p) => p.date === "2026-03-03")!;
    const before = result.series.find((p) => p.date === "2026-03-02")!;
    const dayReturn = (1 + day.cumulative!) / (1 + before.cumulative!) - 1;
    expect(dayReturn).toBeGreaterThan(-0.02);
    expect(dayReturn).toBeLessThan(0);
  });
});

describe("computePortfolioReturn — 邊界", () => {
  it("returns null, not 0, before the first exposure and when there is none at all", () => {
    const result = run([trade("A", "BUY", 100, 99, "2026-03-04")]);

    expect(result.series.map((p) => p.cumulative === null)).toEqual([true, true, false, false, false]);
    expect(run([]).twr).toBeNull();
    expect(run([]).series.every((p) => p.cumulative === null)).toBe(true);
  });

  // 第一版的缺陷：只在持有的日子才記錄收盤價，所以「買進當天沒成交」會退回用交易價，而不是前一天的收盤。
  it("carries forward the last close from before the purchase when the purchase day has none", () => {
    const sparse: [string, number][] = [[BASE, 20], ["2026-03-02", 20], ["2026-03-04", 22], ["2026-03-05", 22], ["2026-03-06", 22]];
    const result = run([trade("C", "BUY", 100, 25, "2026-03-03")], { C: sparse });

    // 03-03 沒有收盤價：沿用 03-02 的 20，所以買進當天的報酬是 2000 ÷ 2500 − 1 = −20%（不是用交易價 25 算出的 0%）。
    expect(result.series.find((p) => p.date === "2026-03-03")!.cumulative).toBeCloseTo(-0.2, 12);
    expect(result.missingPriceDays.get("C")).toBe(1);
  });

  it("falls back to the trade price only when there is no close at all, and reports it", () => {
    const result = run([trade("D", "BUY", 10, 30, "2026-03-04")]);

    expect(result.twr).toBeCloseTo(0, 12);
    expect(result.missingPriceDays.get("D")).toBe(3);
  });

  it("books a trade dated on a non-trading day onto the next trading day", () => {
    const result = computePortfolioReturn({
      entries: [trade("A", "BUY", 100, 102, "2026-03-02"), trade("A", "BUY", 100, 99, "2026-03-03")],
      calendar: ["2026-03-02", "2026-03-04"],
      baseDate: BASE,
      closes: closes({ A: A_CLOSES }),
    });

    // 03-03 不在日曆上，那筆買進落在 03-04：流入 9,900、收盤後 200 × 105。
    expect(result.series.at(-1)!.cumulative).not.toBeNull();
    expect(result.twr).toBeCloseTo((1 + (102 - 102) / 10_200) * (1 + (200 * 105 - 100 * 102 - 9900) / (100 * 102 + 9900)) - 1, 12);
  });

  it("ignores a clamped sell of zero shares instead of producing −100%", () => {
    const result = run([trade("A", "BUY", 100, 100, "2026-03-02"), trade("A", "SELL", 100, 99, "2026-03-03"), trade("A", "SELL", 50, 105, "2026-03-04", 20, 15)]);

    expect(result.twr).toBeGreaterThan(-0.05);
  });
});
