import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domainBff/stock/stockQuote.client.js", () => ({
  fetchStockQuote: vi.fn(),
  fetchStockPrices: vi.fn(),
}));

vi.mock("@/domainBff/stock/companyProfile.client.js", () => ({
  fetchCompanyProfile: vi.fn(),
}));

vi.mock("@/domainBff/stock/capitalStockHistory.client.js", () => ({
  fetchCapitalStockHistory: vi.fn(),
}));

vi.mock("@/domainBff/stock/exDividendNotices.client.js", () => ({
  fetchExDividendNotices: vi.fn(),
}));

vi.mock("@/domainBff/stock/financialStatement.client.js", () => ({
  fetchFinancialStatement: vi.fn(),
}));

import { fetchCapitalStockHistory } from "@/domainBff/stock/capitalStockHistory.client.js";
import { fetchCompanyProfile } from "@/domainBff/stock/companyProfile.client.js";
import { fetchExDividendNotices } from "@/domainBff/stock/exDividendNotices.client.js";
import { fetchFinancialStatement } from "@/domainBff/stock/financialStatement.client.js";
import { fetchStockPrices, fetchStockQuote } from "@/domainBff/stock/stockQuote.client.js";
import {
  assertSymbolExists,
  getCapitalStockHistory,
  getCompanyProfile,
  getExDividendNotices,
  getFinancialStatement,
  getLatestClosePrices,
  getStockQuote,
} from "@/domainBff/stock/stock.service.js";

beforeEach(() => {
  vi.mocked(fetchStockQuote).mockReset();
  vi.mocked(fetchStockPrices).mockReset();
  vi.mocked(fetchCompanyProfile).mockReset();
  vi.mocked(fetchCapitalStockHistory).mockReset();
  vi.mocked(fetchExDividendNotices).mockReset();
  vi.mocked(fetchFinancialStatement).mockReset();
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

describe("assertSymbolExists", () => {
  it("resolves silently when the symbol has a quote", async () => {
    vi.mocked(fetchStockQuote).mockResolvedValue({ symbol: "2330", price: null, valuation: null });

    await expect(assertSymbolExists("2330")).resolves.toBeUndefined();
  });

  it("throws a 404 AppError when the symbol doesn't exist in either market", async () => {
    vi.mocked(fetchStockQuote).mockResolvedValue(null);

    await expect(assertSymbolExists("NOPE")).rejects.toMatchObject({
      statusCode: 404,
      message: 'Unknown stock symbol "NOPE"',
    });
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

describe("getFinancialStatement", () => {
  it("delegates to fetchFinancialStatement and returns its result as-is", async () => {
    const statement = {
      symbol: "2330",
      statementType: "balanceSheet" as const,
      dataType: "2",
      subsidiaryCompanyId: "",
      year: "115",
      season: "2",
      reportDate: "2026-06-30",
      found: true,
      statement: { totalAssets: "9375654727" },
    };
    vi.mocked(fetchFinancialStatement).mockResolvedValue(statement);

    await expect(getFinancialStatement("2330", "balanceSheet", "115", "2")).resolves.toEqual(statement);
    expect(fetchFinancialStatement).toHaveBeenCalledWith("2330", "balanceSheet", "115", "2");
  });

  it("forwards undefined year/season through when omitted (analysis-ts resolves latest quarter)", async () => {
    vi.mocked(fetchFinancialStatement).mockResolvedValue({
      symbol: "2330",
      statementType: "incomeStatement",
      dataType: "2",
      subsidiaryCompanyId: "",
      year: "115",
      season: "2",
      reportDate: "2026-06-30",
      found: true,
      statement: {},
    });

    await getFinancialStatement("2330", "incomeStatement");

    expect(fetchFinancialStatement).toHaveBeenCalledWith("2330", "incomeStatement", undefined, undefined);
  });
});
