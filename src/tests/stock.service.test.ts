import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../adapters/neon/index.js", () => ({
  queryNeon: vi.fn(),
}));

import { queryNeon } from "../adapters/neon/index.js";
import { getStockQuote } from "../domains/stock/stock.service.js";

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
