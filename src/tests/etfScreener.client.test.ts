import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchEtfFieldCatalog, fetchEtfScreenerResults } from "@/domainBff/etfScreener/etfScreener.client.js";

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

describe("fetchEtfFieldCatalog", () => {
  // Restructured 2026-09-11: analysis-ts changed this from a flat `{ fields: [...] }` array to nested
  // `{ categories: [{ categoryKey, categoryDisplayName, fields }] }`, matching GET /metrics' shape.
  it("GETs /etf-screener/filters and normalizes nested categories with numeric and categorical fields", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "sizeAndFlow",
            categoryDisplayName: "規模與資金",
            fields: [{ field: "aum", label: "規模", unit: "元", kind: "numeric" }],
          },
          {
            categoryKey: "identity",
            categoryDisplayName: "基本資料",
            fields: [{ field: "market", label: "市場別", kind: "categorical", values: ["TWSE", "TPEx"] }],
          },
        ],
      },
    });

    const catalog = await fetchEtfFieldCatalog();

    expect(catalog).toEqual({
      categories: [
        {
          categoryKey: "sizeAndFlow",
          categoryDisplayName: "規模與資金",
          fields: [{ field: "aum", label: "規模", unit: "元", kind: "numeric" }],
        },
        {
          categoryKey: "identity",
          categoryDisplayName: "基本資料",
          fields: [{ field: "market", label: "市場別", kind: "categorical", values: ["TWSE", "TPEx"] }],
        },
      ],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/etf-screener/filters");
  });

  it("omits `values` for a numeric field rather than defaulting it to an empty array", async () => {
    mockFetchOnce({
      ok: true,
      body: { categories: [{ categoryKey: "sizeAndFlow", categoryDisplayName: "規模與資金", fields: [{ field: "aum", label: "規模", kind: "numeric" }] }] },
    });

    const catalog = await fetchEtfFieldCatalog();

    expect(catalog.categories[0]?.fields[0]).not.toHaveProperty("values");
  });

  it("omits `unit` for a categorical field, and for a numeric field analysis-ts didn't set it on", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        categories: [
          {
            categoryKey: "identity",
            categoryDisplayName: "基本資料",
            fields: [
              { field: "establishedDate", label: "成立日", kind: "date" },
              { field: "assetClass", label: "資產類型", kind: "categorical", values: ["國內成分證券"] },
            ],
          },
        ],
      },
    });

    const catalog = await fetchEtfFieldCatalog();

    expect(catalog.categories[0]?.fields[0]).not.toHaveProperty("unit");
    expect(catalog.categories[0]?.fields[1]).not.toHaveProperty("unit");
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchEtfFieldCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing a categories array", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchEtfFieldCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchEtfScreenerResults", () => {
  it("POSTs filters/columns/pagination/sort and normalizes result rows", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        count: 164,
        page: 1,
        pageSize: 2,
        totalPages: 82,
        results: [
          {
            symbol: "0050",
            fundName: "元大台灣卓越50基金",
            shortName: "元大台灣50",
            companyName: "元大投信",
            category: "上市ETF_國內成分證券ETF",
            values: { aum: 2283731446214, expenseRatio: 0.02, market: "TWSE", isActive: false },
          },
        ],
      },
    });

    const result = await fetchEtfScreenerResults(
      [{ field: "market", values: ["TWSE"] }],
      [{ field: "aum" }, { field: "expenseRatio" }],
      1,
      2,
      { field: "aum", order: "desc" },
    );

    expect(result).toEqual({
      count: 164,
      page: 1,
      pageSize: 2,
      totalPages: 82,
      results: [
        {
          symbol: "0050",
          fundName: "元大台灣卓越50基金",
          shortName: "元大台灣50",
          issuerName: "元大投信",
          category: "上市ETF_國內成分證券ETF",
          values: { aum: 2283731446214, expenseRatio: 0.02, market: "TWSE", isActive: false },
        },
      ],
    });

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = call?.[0] as URL;
    const init = call?.[1] as RequestInit;
    expect(url.toString()).toBe("http://filters.test/etf-screener");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      filters: [{ field: "market", values: ["TWSE"] }],
      columns: [{ field: "aum" }, { field: "expenseRatio" }],
      page: 1,
      pageSize: 2,
      sortField: "aum",
      sortOrder: "desc",
    });
  });

  it("keeps a null value as null and preserves booleans, without stringifying numbers", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        count: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        results: [
          {
            symbol: "00980A",
            fundName: "主動式測試基金",
            shortName: "主動式測試",
            companyName: null,
            category: "上市ETF_主動式ETF",
            values: { expenseRatio: null, isActive: true, aum: 100 },
          },
        ],
      },
    });

    const result = await fetchEtfScreenerResults([], [{ field: "expenseRatio" }], 1, 50);

    expect(result.results[0]?.values).toEqual({ expenseRatio: null, isActive: true, aum: 100 });
    expect(result.results[0]?.issuerName).toBeNull();
  });

  it("relays analysis-ts's 400 message for an unknown field", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: '"nope" 不是 GET /etf-screener/filters 列出的欄位。' } });

    await expect(fetchEtfScreenerResults([{ field: "nope", min: 1, max: null, exclude: false }], [], 1, 50)).rejects.toMatchObject({
      statusCode: 400,
      message: '"nope" 不是 GET /etf-screener/filters 列出的欄位。',
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchEtfScreenerResults([], [{ field: "aum" }], 1, 50)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing required fields", async () => {
    mockFetchOnce({ ok: true, body: { count: 1 } });

    await expect(fetchEtfScreenerResults([], [{ field: "aum" }], 1, 50)).rejects.toMatchObject({ statusCode: 502 });
  });
});
