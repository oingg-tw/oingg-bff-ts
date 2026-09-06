import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFinancialStatement } from "@/domainBff/stock/financialStatement.client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FILTERS_URL = process.env.FILTERS_SERVICE_URL;

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://filters.test";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_FILTERS_URL === undefined) {
    delete process.env.FILTERS_SERVICE_URL;
  } else {
    process.env.FILTERS_SERVICE_URL = ORIGINAL_FILTERS_URL;
  }
});

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  }) as unknown as typeof fetch;
}

// Real 2330 115Q2 balance sheet, given directly by analysis-ts (2026-09-06).
const BALANCE_SHEET_BODY = {
  symbol: "2330",
  statementType: "balanceSheet",
  dataType: "2",
  subsidiaryCompanyId: "",
  year: "115",
  season: "2",
  reportDate: "2026-06-30",
  found: true,
  statement: {
    cashAndEquivalents: "3134218213",
    accountsReceivable: "435762477",
    currentAssets: "4565700742",
    totalAssets: "9375654727",
    shortTermBorrowings: null,
    totalLiabilities: "2901183746",
    totalEquity: "6474470981",
    totalLiabilitiesAndEquity: "9375654727",
  },
};

const NOT_FOUND_BODY = {
  symbol: "9999",
  statementType: "balanceSheet",
  dataType: "2",
  subsidiaryCompanyId: "",
  year: null,
  season: null,
  reportDate: null,
  found: false,
  statement: null,
};

describe("fetchFinancialStatement", () => {
  it("requests /companies/financial-statement with symbol/statementType and normalizes the response", async () => {
    mockFetchOnce({ ok: true, body: BALANCE_SHEET_BODY });

    const result = await fetchFinancialStatement("2330", "balanceSheet");

    expect(result).toEqual(BALANCE_SHEET_BODY);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/financial-statement?symbol=2330&statementType=balanceSheet");
  });

  it("includes year/season in the request when both are given", async () => {
    mockFetchOnce({ ok: true, body: BALANCE_SHEET_BODY });

    await fetchFinancialStatement("2330", "balanceSheet", "115", "2");

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe(
      "http://filters.test/companies/financial-statement?symbol=2330&statementType=balanceSheet&year=115&season=2",
    );
  });

  // A field genuinely absent/zero on the source statement (e.g. shortTermBorrowings here) must stay
  // null, not get coerced to "0" or dropped from the object — analysis-ts confirmed null means "not
  // disclosed", never a fetch failure.
  it("preserves a null line-item value as null, not coerced to a string", async () => {
    mockFetchOnce({ ok: true, body: BALANCE_SHEET_BODY });

    const result = await fetchFinancialStatement("2330", "balanceSheet");

    expect(result.statement?.shortTermBorrowings).toBeNull();
  });

  it("returns found:false with a null statement for an unknown symbol or a quarter with no filing, without throwing", async () => {
    mockFetchOnce({ ok: true, body: NOT_FOUND_BODY });

    await expect(fetchFinancialStatement("9999", "balanceSheet")).resolves.toEqual(NOT_FOUND_BODY);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchFinancialStatement("2330", "balanceSheet")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchFinancialStatement("2330", "balanceSheet")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response body isn't an object", async () => {
    mockFetchOnce({ ok: true, body: null });

    await expect(fetchFinancialStatement("2330", "balanceSheet")).rejects.toMatchObject({ statusCode: 502 });
  });
});
