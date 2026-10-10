import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFinancialStatement } from "@/infrastructure/analysisApi/stock/financialStatement.client.js";

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

// Real 2330 115Q2 balance sheet, given directly by analysis-ts (2026-09-06)；期別欄位換成批次 2c（2026-10-10）的新名。
const BALANCE_SHEET_BODY = {
  symbol: "2330",
  statementType: "balanceSheet",
  dataType: "2",
  subsidiaryCompanyId: "",
  fiscalYear: 2026,
  fiscalQuarter: 2,
  fiscalPeriodEndDate: "2026-06-30",
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
  fiscalYear: null,
  fiscalQuarter: null,
  fiscalPeriodEndDate: null,
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

  it("sends fiscalYear/fiscalQuarter (Western year, int) when both are given", async () => {
    mockFetchOnce({ ok: true, body: BALANCE_SHEET_BODY });

    await fetchFinancialStatement("2330", "balanceSheet", 2026, 2);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe(
      "http://filters.test/companies/financial-statement?symbol=2330&statementType=balanceSheet&fiscalYear=2026&fiscalQuarter=2",
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

  // 批次 2c 並存期：部署的 analysis-ts 可能只送舊名，舊 year 是民國年字串，要換算成西元整數。
  it("reads the pre-2026-10-10 ROC year/season/reportDate when upstream hasn't deployed batch 2c", async () => {
    const { fiscalYear: _y, fiscalQuarter: _q, fiscalPeriodEndDate: _d, ...rest } = BALANCE_SHEET_BODY;
    mockFetchOnce({ ok: true, body: { ...rest, year: "115", season: "2", reportDate: "2026-06-30" } });

    await expect(fetchFinancialStatement("2330", "balanceSheet")).resolves.toMatchObject({
      fiscalYear: 2026,
      fiscalQuarter: 2,
      fiscalPeriodEndDate: "2026-06-30",
    });
  });

  // found 為 false 時上游新名曾是 null、舊 year 卻回顯查詢的年度（實測 2026-10-10，上游 fb65b1b1 已改成一致）。
  // 新名在就以新名為準（null 也算），不能拿舊名的回顯補。
  it("keeps fiscalYear null on found:false even though the old year echoes the requested year", async () => {
    mockFetchOnce({ ok: true, body: { ...NOT_FOUND_BODY, symbol: "6488", year: "108", season: "4", reportDate: null } });

    await expect(fetchFinancialStatement("6488", "incomeStatement", 2019, 4)).resolves.toMatchObject({
      found: false,
      fiscalYear: null,
      fiscalQuarter: null,
    });
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
