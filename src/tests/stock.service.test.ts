import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../adapters/neon/index.js", () => ({
  queryNeon: vi.fn(),
}));

import { queryNeon } from "../adapters/neon/index.js";
import { getLatestClosePrices, getStockQuote, getValuationRanking } from "../domains/stock/stock.service.js";

const emptyResult = { rows: [] };

describe("getStockQuote", () => {
  beforeEach(() => {
    vi.mocked(queryNeon).mockReset();
  });

  it("returns the TWSE quote when TWSE has price and valuation data for the symbol", async () => {
    vi.mocked(queryNeon).mockImplementation(async (market, sql) => {
      if (market !== "twse") return emptyResult as never;
      if (String(sql).includes("daily_price")) {
        return { rows: [{ tradeDate: new Date("2026-08-18"), close: "2350.0000" }] } as never;
      }
      return {
        rows: [{ tradeDate: new Date("2026-08-16"), peRatio: "27.82", pbRatio: "9.68", dividendYield: "0.92" }],
      } as never;
    });

    const quote = await getStockQuote("2330");

    expect(quote).toEqual({
      symbol: "2330",
      market: "twse",
      price: { tradeDate: "2026-08-18", close: "2350.0000" },
      valuation: { tradeDate: "2026-08-16", peRatio: "27.82", pbRatio: "9.68", dividendYield: "0.92" },
    });
  });

  it("falls back to TPEx when TWSE has nothing for the symbol (listed symbols don't overlap between markets)", async () => {
    vi.mocked(queryNeon).mockImplementation(async (market, sql) => {
      if (market !== "tpex") return emptyResult as never;
      if (String(sql).includes("daily_valuation")) {
        return {
          rows: [{ tradeDate: new Date("2026-08-19"), peRatio: "10.61", pbRatio: "1.68", dividendYield: "0.88" }],
        } as never;
      }
      return emptyResult as never;
    });

    const quote = await getStockQuote("1240");

    expect(quote?.market).toBe("tpex");
    expect(quote?.price).toBeNull();
    expect(quote?.valuation?.peRatio).toBe("10.61");
  });

  it("returns null when neither market has any data for the symbol", async () => {
    vi.mocked(queryNeon).mockResolvedValue(emptyResult as never);

    const quote = await getStockQuote("NOPE");

    expect(quote).toBeNull();
  });
});

// Regression test: the screener used to fetch each matched symbol's price with a separate
// getStockQuote() call — a 50-row result fired 200 individual queries (2 markets x 2 tables x 50
// symbols). getLatestClosePrices() must cover the whole symbol list in one query per market instead.
describe("getLatestClosePrices", () => {
  beforeEach(() => {
    vi.mocked(queryNeon).mockReset();
  });

  it("issues exactly one query per market regardless of how many symbols are requested", async () => {
    vi.mocked(queryNeon).mockImplementation(async (market) => {
      if (market === "twse") {
        return { rows: [{ symbol: "2330", close: "2410.0000" }] } as never;
      }
      return { rows: [{ symbol: "1240", close: "15.5000" }] } as never;
    });

    const prices = await getLatestClosePrices(["2330", "1240", "9999"]);

    expect(queryNeon).toHaveBeenCalledTimes(2);
    expect(prices.get("2330")).toBe("2410.0000");
    expect(prices.get("1240")).toBe("15.5000");
    expect(prices.has("9999")).toBe(false);
  });

  it("returns an empty map without querying when given no symbols", async () => {
    const prices = await getLatestClosePrices([]);

    expect(queryNeon).not.toHaveBeenCalled();
    expect(prices.size).toBe(0);
  });
});

// Regression coverage: this exists specifically because analysis-ts's own valuation_market_ratios
// table is only lazily populated (a couple of symbols today), while twse/tpex's daily_valuation already
// has whole-market same-day figures — see the comment on getValuationRanking. Confirmed with
// oingg-analysis-ts directly that their own GET /valuation/ranking uses the same peRatio/pbRatio <= 0
// exclusion rule (loss-making/negative-equity companies aren't "cheap") — kept consistent here.
describe("getValuationRanking", () => {
  beforeEach(() => {
    vi.mocked(queryNeon).mockReset();
  });

  it("queries exactly one query per market and merges/re-sorts the combined top rows", async () => {
    vi.mocked(queryNeon).mockImplementation(async (market) => {
      if (market === "twse") {
        return { rows: [{ symbol: "2330", value: "27.82" }, { symbol: "2317", value: "15.00" }] } as never;
      }
      return { rows: [{ symbol: "1240", value: "10.61" }] } as never;
    });

    const ranking = await getValuationRanking("peRatio", "asc", 2);

    expect(queryNeon).toHaveBeenCalledTimes(2);
    // Merged across both markets, re-sorted ascending, trimmed to the requested limit.
    expect(ranking).toEqual([
      { symbol: "1240", value: "10.61" },
      { symbol: "2317", value: "15.00" },
    ]);
  });

  it("excludes peRatio/pbRatio <= 0 (loss-making or negative book equity), but not dividendYield = 0", async () => {
    vi.mocked(queryNeon).mockResolvedValue({ rows: [] } as never);

    await getValuationRanking("peRatio", "asc", 10);
    expect(vi.mocked(queryNeon).mock.calls[0]![1]).toContain("value > 0");

    vi.mocked(queryNeon).mockClear();
    await getValuationRanking("dividendYield", "desc", 10);
    expect(vi.mocked(queryNeon).mock.calls[0]![1]).toContain("value IS NOT NULL");
    expect(vi.mocked(queryNeon).mock.calls[0]![1]).not.toContain("value > 0");
  });

  it("sorts DESC for highest-first rankings (e.g. highest dividend yield)", async () => {
    vi.mocked(queryNeon).mockImplementation(async (market) => {
      if (market === "twse") return { rows: [{ symbol: "A", value: "3.5" }] } as never;
      return { rows: [{ symbol: "B", value: "5.0" }] } as never;
    });

    const ranking = await getValuationRanking("dividendYield", "desc", 2);

    expect(ranking).toEqual([
      { symbol: "B", value: "5.0" },
      { symbol: "A", value: "3.5" },
    ]);
  });
});
