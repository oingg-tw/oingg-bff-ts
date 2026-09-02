import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/stock/stockQuote.client.js", () => ({
  fetchStockQuote: vi.fn(),
  fetchStockPrices: vi.fn(),
}));

vi.mock("@/domains/stock/companyProfile.client.js", () => ({
  fetchCompanyProfile: vi.fn(),
}));

import { fetchCompanyProfile } from "@/domains/stock/companyProfile.client.js";
import { fetchStockPrices, fetchStockQuote } from "@/domains/stock/stockQuote.client.js";
import { getCompanyProfile, getLatestClosePrices, getStockQuote } from "@/domains/stock/stock.service.js";

beforeEach(() => {
  vi.mocked(fetchStockQuote).mockReset();
  vi.mocked(fetchStockPrices).mockReset();
  vi.mocked(fetchCompanyProfile).mockReset();
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

describe("getCompanyProfile", () => {
  it("delegates to fetchCompanyProfile and returns its result as-is", async () => {
    const profile = { symbol: "2330", market: "TWSE" as const, name: "台積電" } as never;
    vi.mocked(fetchCompanyProfile).mockResolvedValue(profile);

    await expect(getCompanyProfile("2330")).resolves.toEqual(profile);
    expect(fetchCompanyProfile).toHaveBeenCalledWith("2330");
  });

  it("passes through null (not found in either market) without throwing", async () => {
    vi.mocked(fetchCompanyProfile).mockResolvedValue(null);

    await expect(getCompanyProfile("nope")).resolves.toBeNull();
  });
});
