import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/stock/stockQuote.client.js", () => ({
  fetchStockQuote: vi.fn(),
  fetchStockPrices: vi.fn(),
}));

vi.mock("@/domains/stock/companyProfile.client.js", () => ({
  fetchCompanyProfile: vi.fn(),
}));

vi.mock("@/domains/stock/capitalStockHistory.client.js", () => ({
  fetchCapitalStockHistory: vi.fn(),
}));

vi.mock("@/domains/stock/exDividendNotices.client.js", () => ({
  fetchExDividendNotices: vi.fn(),
}));

import { fetchCapitalStockHistory } from "@/domains/stock/capitalStockHistory.client.js";
import { fetchCompanyProfile } from "@/domains/stock/companyProfile.client.js";
import { fetchExDividendNotices } from "@/domains/stock/exDividendNotices.client.js";
import { fetchStockPrices, fetchStockQuote } from "@/domains/stock/stockQuote.client.js";
import {
  getCapitalStockHistory,
  getCompanyProfile,
  getExDividendNotices,
  getLatestClosePrices,
  getStockQuote,
} from "@/domains/stock/stock.service.js";

beforeEach(() => {
  vi.mocked(fetchStockQuote).mockReset();
  vi.mocked(fetchStockPrices).mockReset();
  vi.mocked(fetchCompanyProfile).mockReset();
  vi.mocked(fetchCapitalStockHistory).mockReset();
  vi.mocked(fetchExDividendNotices).mockReset();
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

describe("getCapitalStockHistory", () => {
  it("delegates to fetchCapitalStockHistory and returns its result as-is", async () => {
    const history = { symbol: "2330", entries: [] };
    vi.mocked(fetchCapitalStockHistory).mockResolvedValue(history);

    await expect(getCapitalStockHistory("2330")).resolves.toEqual(history);
    expect(fetchCapitalStockHistory).toHaveBeenCalledWith("2330");
  });
});

describe("getExDividendNotices", () => {
  it("delegates to fetchExDividendNotices and returns its result as-is", async () => {
    const notices = new Map([["2330", []]]);
    vi.mocked(fetchExDividendNotices).mockResolvedValue(notices);

    await expect(getExDividendNotices(["2330", "00939"])).resolves.toBe(notices);
    expect(fetchExDividendNotices).toHaveBeenCalledWith(["2330", "00939"]);
  });
});
