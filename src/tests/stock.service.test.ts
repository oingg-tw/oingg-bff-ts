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

vi.mock("@/domainBff/stock/preferredStocks.client.js", () => ({
  fetchPreferredStocks: vi.fn(),
}));

vi.mock("@/domainBff/stock/metricHistory.client.js", () => ({
  fetchMetricHistory: vi.fn(),
}));

vi.mock("@/domainBff/stock/roeRoaHistory.client.js", () => ({
  fetchRoeHistory: vi.fn(),
  fetchRoaHistory: vi.fn(),
}));

vi.mock("@/domainBff/stock/dupontHistory.client.js", () => ({
  fetchDupontHistory: vi.fn(),
}));

vi.mock("@/domainBff/stock/monthlyRevenueHistory.client.js", () => ({
  fetchMonthlyRevenueHistory: vi.fn(),
}));

import { fetchCapitalStockHistory } from "@/domainBff/stock/capitalStockHistory.client.js";
import { fetchCompanyProfile } from "@/domainBff/stock/companyProfile.client.js";
import { fetchDupontHistory } from "@/domainBff/stock/dupontHistory.client.js";
import { fetchExDividendNotices } from "@/domainBff/stock/exDividendNotices.client.js";
import { fetchFinancialStatement } from "@/domainBff/stock/financialStatement.client.js";
import { fetchMetricHistory } from "@/domainBff/stock/metricHistory.client.js";
import { fetchMonthlyRevenueHistory } from "@/domainBff/stock/monthlyRevenueHistory.client.js";
import { fetchPreferredStocks } from "@/domainBff/stock/preferredStocks.client.js";
import { fetchRoaHistory, fetchRoeHistory } from "@/domainBff/stock/roeRoaHistory.client.js";
import { fetchStockPrices, fetchStockQuote } from "@/domainBff/stock/stockQuote.client.js";
import {
  assertSymbolExists,
  getCapitalStockHistory,
  getCompanyProfile,
  getDupontHistory,
  getExDividendNotices,
  getFinancialStatement,
  getLatestClosePrices,
  getMetricHistory,
  getMonthlyRevenueHistory,
  getPreferredStocks,
  getRoaHistory,
  getRoeHistory,
  getStockQuote,
} from "@/domainBff/stock/stock.service.js";

beforeEach(() => {
  vi.mocked(fetchStockQuote).mockReset();
  vi.mocked(fetchStockPrices).mockReset();
  vi.mocked(fetchCompanyProfile).mockReset();
  vi.mocked(fetchCapitalStockHistory).mockReset();
  vi.mocked(fetchExDividendNotices).mockReset();
  vi.mocked(fetchFinancialStatement).mockReset();
  vi.mocked(fetchPreferredStocks).mockReset();
  vi.mocked(fetchMetricHistory).mockReset();
  vi.mocked(fetchRoeHistory).mockReset();
  vi.mocked(fetchRoaHistory).mockReset();
  vi.mocked(fetchDupontHistory).mockReset();
  vi.mocked(fetchMonthlyRevenueHistory).mockReset();
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

describe("getPreferredStocks", () => {
  it("delegates to fetchPreferredStocks and returns its result as-is", async () => {
    const result = { entries: [{ symbol: "1101B" }] } as never;
    vi.mocked(fetchPreferredStocks).mockResolvedValue(result);

    await expect(getPreferredStocks("1101B")).resolves.toEqual(result);
    expect(fetchPreferredStocks).toHaveBeenCalledWith("1101B");
  });

  it("forwards undefined through when no symbol is given (analysis-ts returns every listed issue)", async () => {
    vi.mocked(fetchPreferredStocks).mockResolvedValue({ entries: [] });

    await getPreferredStocks();

    expect(fetchPreferredStocks).toHaveBeenCalledWith(undefined);
  });
});

describe("getMetricHistory", () => {
  it("delegates to fetchMetricHistory and returns its result as-is", async () => {
    const result = { symbol: "2330", metricCode: "peRatio", basis: "TTM", entries: [] } as never;
    vi.mocked(fetchMetricHistory).mockResolvedValue(result);

    await expect(getMetricHistory("2330", "peRatio", "TTM", 5)).resolves.toEqual(result);
    expect(fetchMetricHistory).toHaveBeenCalledWith("2330", "peRatio", "TTM", 5);
  });

  it("forwards undefined limit through when omitted (analysis-ts applies its own default)", async () => {
    vi.mocked(fetchMetricHistory).mockResolvedValue({ symbol: "2330", metricCode: "eps", basis: "Q", total: 0, hasMore: false, entries: [] });

    await getMetricHistory("2330", "eps", "Q");

    expect(fetchMetricHistory).toHaveBeenCalledWith("2330", "eps", "Q", undefined);
  });
});

describe("getRoeHistory", () => {
  it("delegates to fetchRoeHistory and returns its result as-is", async () => {
    const result = { symbol: "2330", basis: "TTM", entries: [] } as never;
    vi.mocked(fetchRoeHistory).mockResolvedValue(result);

    await expect(getRoeHistory("2330", "TTM", 5)).resolves.toEqual(result);
    expect(fetchRoeHistory).toHaveBeenCalledWith("2330", "TTM", 5);
  });
});

describe("getRoaHistory", () => {
  it("delegates to fetchRoaHistory and returns its result as-is", async () => {
    const result = { symbol: "2330", basis: "Q_ANN", entries: [] } as never;
    vi.mocked(fetchRoaHistory).mockResolvedValue(result);

    await expect(getRoaHistory("2330", "Q_ANN")).resolves.toEqual(result);
    expect(fetchRoaHistory).toHaveBeenCalledWith("2330", "Q_ANN", undefined);
  });
});

describe("getDupontHistory", () => {
  it("delegates to fetchDupontHistory and returns its result as-is", async () => {
    const result = { symbol: "2330", basis: "Q", entries: [] } as never;
    vi.mocked(fetchDupontHistory).mockResolvedValue(result);

    await expect(getDupontHistory("2330", "Q", 10)).resolves.toEqual(result);
    expect(fetchDupontHistory).toHaveBeenCalledWith("2330", "Q", 10);
  });
});

describe("getMonthlyRevenueHistory", () => {
  it("delegates to fetchMonthlyRevenueHistory and returns its result as-is", async () => {
    const result = { symbol: "2330", entries: [] } as never;
    vi.mocked(fetchMonthlyRevenueHistory).mockResolvedValue(result);

    await expect(getMonthlyRevenueHistory("2330", 12)).resolves.toEqual(result);
    expect(fetchMonthlyRevenueHistory).toHaveBeenCalledWith("2330", 12);
  });

  it("forwards undefined limit through when omitted (analysis-ts returns everything)", async () => {
    vi.mocked(fetchMonthlyRevenueHistory).mockResolvedValue({ symbol: "2330", total: 0, hasMore: false, entries: [] });

    await getMonthlyRevenueHistory("2330");

    expect(fetchMonthlyRevenueHistory).toHaveBeenCalledWith("2330", undefined);
  });
});
