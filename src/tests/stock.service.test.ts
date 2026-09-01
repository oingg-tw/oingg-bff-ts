import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/stock/stockQuote.client.js", () => ({
  fetchStockQuote: vi.fn(),
  fetchStockPrices: vi.fn(),
}));

import { fetchStockPrices, fetchStockQuote } from "@/domains/stock/stockQuote.client.js";
import { getLatestClosePrices, getStockQuote } from "@/domains/stock/stock.service.js";

beforeEach(() => {
  vi.mocked(fetchStockQuote).mockReset();
  vi.mocked(fetchStockPrices).mockReset();
});

describe("getStockQuote", () => {
  it("delegates to fetchStockQuote and returns its result as-is", async () => {
    const quote = { symbol: "2330", price: { tradeDate: "2026-09-01", close: "1090" }, valuation: null };
    vi.mocked(fetchStockQuote).mockResolvedValue(quote);

    await expect(getStockQuote("2330")).resolves.toEqual(quote);
    expect(fetchStockQuote).toHaveBeenCalledWith("2330");
  });

  it("passes through null (unknown symbol in either market) without throwing", async () => {
    vi.mocked(fetchStockQuote).mockResolvedValue(null);

    await expect(getStockQuote("nope")).resolves.toBeNull();
  });
});

describe("getLatestClosePrices", () => {
  it("delegates to fetchStockPrices and returns its result as-is", async () => {
    const prices = new Map([["2330", { close: "1090", tradeDate: "2026-09-01" }]]);
    vi.mocked(fetchStockPrices).mockResolvedValue(prices);

    await expect(getLatestClosePrices(["2330", "1240"])).resolves.toBe(prices);
    expect(fetchStockPrices).toHaveBeenCalledWith(["2330", "1240"]);
  });
});
