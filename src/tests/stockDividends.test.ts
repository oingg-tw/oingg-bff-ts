import { describe, expect, it } from "vitest";
import { projectHoldings, type LedgerEntry } from "@/domain/holdingProjection.js";
import { computePortfolioReturn } from "@/domain/portfolioReturn.js";
import { withStockDividends } from "@/domain/stockDividends.js";

let seq = 0;
function e(symbol: string, action: "BUY" | "SELL", quantity: number, price: number, tradeDate: string, extra: Partial<LedgerEntry> = {}): LedgerEntry {
  return { symbol, action, quantity, price, fee: 0, tax: 0, tradeDate, createdAt: `2026-01-01T00:00:00.${String(seq++).padStart(3, "0")}Z`, ...extra };
}

describe("withStockDividends", () => {
  /**
   * 錨點是使用者的**真實券商紀錄**（2026-10-05，web-nuxt 提供股數）：兩檔用行事曆的 stockDividendRatio
   * 都完全對上實際賣出的股數。用 stockDividend ÷ 10 會算出 632 與 256，兩個都錯。
   */
  it("matches the user's real broker fills for 5314 and 7740 exactly", () => {
    const { entries, dividends } = withStockDividends(
      [e("5314", "BUY", 4000, 60, "2026-06-01"), e("7740", "BUY", 2000, 50, "2026-06-01")],
      [
        { symbol: "5314", exRightsDate: "2026-08-14", sharesPerShare: 3.157 },
        { symbol: "7740", exRightsDate: "2026-07-24", sharesPerShare: 0.1278 },
      ],
    );

    expect(dividends.map((d) => [d.symbol, d.quantity])).toEqual([["7740", 255], ["5314", 12_628]]);
    const sells = [e("5314", "SELL", 12_628, 15, "2026-09-17"), e("7740", "SELL", 255, 60, "2026-09-16")];
    expect(projectHoldings([...entries, ...sells]).oversold).toEqual([]);
  });

  it("entitles only shares held at the close before the ex-rights date", () => {
    const { dividends } = withStockDividends(
      [e("A", "BUY", 1000, 10, "2026-08-13"), e("A", "BUY", 5000, 10, "2026-08-14"), e("A", "SELL", 400, 10, "2026-08-14")],
      [{ symbol: "A", exRightsDate: "2026-08-14", sharesPerShare: 0.1 }],
    );

    // 當天買的 5000 股不配；當天賣的 400 股照配（它們在除權前一天收盤時還在手上）。
    expect(dividends).toEqual([{ symbol: "A", exRightsDate: "2026-08-14", sharesPerShare: 0.1, heldBefore: 1000, quantity: 100 }]);
  });

  it("orders the dividend before same-day trades, so a same-day sale can use the new shares", () => {
    const { entries } = withStockDividends([e("A", "BUY", 1000, 10, "2026-08-01")], [{ symbol: "A", exRightsDate: "2026-08-14", sharesPerShare: 0.5 }]);

    expect(projectHoldings([...entries, e("A", "SELL", 1500, 8, "2026-08-14")]).oversold).toEqual([]);
  });

  it("compounds a later dividend on the shares an earlier one created", () => {
    const { dividends } = withStockDividends(
      [e("A", "BUY", 1000, 10, "2025-01-02")],
      [
        { symbol: "A", exRightsDate: "2025-08-01", sharesPerShare: 0.1 },
        { symbol: "A", exRightsDate: "2026-08-01", sharesPerShare: 0.1 },
      ],
    );

    expect(dividends.map((d) => d.quantity)).toEqual([100, 110]);
  });

  // 3.157 × 4000 在 double 裡剛好精確，不能拿來證明這件事；0.29 × 100 才是 28.999999999999996。
  it("does not lose a share to floating point (0.29 × 100 is 28.999… in a double)", () => {
    expect(Math.floor(100 * 0.29)).toBe(28); // 這一行證明保險不是多餘的
    const { dividends } = withStockDividends([e("A", "BUY", 100, 10, "2026-01-02")], [{ symbol: "A", exRightsDate: "2026-08-14", sharesPerShare: 0.29 }]);
    expect(dividends[0]!.quantity).toBe(29);
  });

  it("skips symbols the user did not hold", () => {
    expect(withStockDividends([], [{ symbol: "A", exRightsDate: "2026-08-14", sharesPerShare: 1 }]).dividends).toEqual([]);
  });
});

describe("cost-unknown acquisitions in projectHoldings", () => {
  /**
   * 成本不明的取得代表「很久以前就有的股票」，所以 web-nuxt 把它的日期設在那一檔最早交易的前一天
   * （2026-10-05 起）——FIFO 下它就是最舊的一批、最先被賣掉，成本已知那批的成本完全不被碰到。
   */
  it("sells a cost-unknown lot dated before the known buys first, leaving the known cost intact", () => {
    const { holdings, realizations } = projectHoldings([
      e("5314", "BUY", 12_628, 0, "2026-01-01", { costUnknown: true }),
      e("5314", "BUY", 1000, 100, "2026-01-02"),
      e("5314", "SELL", 12_628, 40, "2026-08-18"),
    ]);

    expect(holdings[0]).toMatchObject({ quantity: 1000, costUnknownQuantity: 0, averageCost: 100, realizedProfitLoss: 0 });
    expect(realizations).toEqual([{ symbol: "5314", tradeDate: "2026-08-18", profitLoss: 0, excludedShares: 12_628 }]);
  });

  // 反過來（成本不明的日期比較晚）FIFO 會先賣成本已知的那批——這就是前端要把它的日期往前放的原因。
  it("sells the known lot first when the cost-unknown lot is newer", () => {
    const { realizations } = projectHoldings([
      e("A", "BUY", 1000, 100, "2026-01-02"),
      e("A", "BUY", 500, 0, "2026-03-01", { costUnknown: true }),
      e("A", "SELL", 1000, 120, "2026-04-01"),
    ]);

    expect(realizations[0]).toEqual({ symbol: "A", tradeDate: "2026-04-01", profitLoss: 20_000, excludedShares: 0 });
  });

  it("splits a sale that spans both kinds, counting only the known part", () => {
    const { holdings, realizations } = projectHoldings([
      e("A", "BUY", 100, 50, "2026-01-02"),
      e("A", "BUY", 300, 0, "2026-02-02", { costUnknown: true }),
      e("A", "SELL", 400, 60, "2026-03-02", { fee: 40, tax: 80 }),
    ]);

    // 300 股成本不明先賣、100 股成本已知：淨價金 23,880 的 1/4 是 5,970，減成本 5,000 = 970。
    expect(realizations[0]).toEqual({ symbol: "A", tradeDate: "2026-03-02", profitLoss: 970, excludedShares: 300 });
    expect(holdings[0]).toMatchObject({ quantity: 0, costUnknownQuantity: 0 });
  });

  it("keeps cost-unknown shares out of the average while they are held", () => {
    const { holdings } = projectHoldings([e("A", "BUY", 100, 50, "2026-01-02"), e("A", "BUY", 900, 0, "2026-02-02", { costUnknown: true })]);

    expect(holdings[0]).toMatchObject({ quantity: 1000, costUnknownQuantity: 900, averageCost: 50, totalCost: 5000 });
  });
});

describe("portfolio return with dividends and cost-unknown shares", () => {
  const calendar = ["2026-08-14", "2026-08-17", "2026-08-18"];
  const flat = new Map([
    ["0050", new Map([["2026-08-13", 50], ["2026-08-14", 50], ["2026-08-17", 50], ["2026-08-18", 50]])],
    ["5314", new Map([["2026-08-13", 40], ["2026-08-14", 40], ["2026-08-17", 40], ["2026-08-18", 40]])],
  ]);

  /** 2026-10-05 實測的反例：股價全不動、真實報酬是 0，價格 0 的「|acq」算出 +25.26%。 */
  it("treats a cost-unknown acquisition as a transfer at market value, not a gain", () => {
    const result = computePortfolioReturn({
      entries: [
        e("0050", "BUY", 40_000, 50, "2026-01-02"),
        e("5314", "BUY", 12_628, 0, "2026-08-18", { costUnknown: true }),
        e("5314", "SELL", 12_628, 40, "2026-08-18"),
      ],
      calendar,
      baseDate: "2026-08-13",
      closes: flat,
    });

    expect(result.twr).toBeCloseTo(0, 12);
  });

  /**
   * 配股照價格 0 算是對的：除權當天股價從 61.3 掉到參考價 61.3 ÷ 4.157，新股的市值剛好補回來。
   * 一個除權日前後股價只有除權調整、沒有真實漲跌的組合，TWR 應該是 0。
   */
  it("nets a stock dividend against the ex-rights price drop", () => {
    const reference = 61.3 / (1 + 3.157);
    const closes = new Map([["5314", new Map([["2026-08-13", 61.3], ["2026-08-14", reference], ["2026-08-17", reference], ["2026-08-18", reference]])]]);
    const { entries } = withStockDividends([e("5314", "BUY", 4000, 60, "2026-06-01")], [{ symbol: "5314", exRightsDate: "2026-08-14", sharesPerShare: 3.157 }]);

    const result = computePortfolioReturn({ entries, calendar, baseDate: "2026-08-13", closes });

    // 12,628 是捨去後的股數，所以跟理論值有一點零股誤差；容許到萬分之一。
    expect(Math.abs(result.twr!)).toBeLessThan(1e-4);
  });
});
