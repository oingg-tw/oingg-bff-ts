import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCapitalStockHistory } from "@/domains/stock/capitalStockHistory.client.js";

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

const RAW_ENTRY_SINGLE_SOURCE = {
  effectiveDate: "2024-08",
  paidInShares: "25932370067",
  paidInCapital: "259323700670",
  changeSource: {
    cashIncrease: "1000000",
    capitalReserveTransfer: "0",
    retainedEarningsTransfer: "0",
    mergerIncrease: "0",
    capitalReduction: "0",
    other: null,
  },
  remarks: null,
};

describe("fetchCapitalStockHistory", () => {
  it("requests /companies/capital-stock-history?symbol= and normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330", entries: [RAW_ENTRY_SINGLE_SOURCE] } });

    const result = await fetchCapitalStockHistory("2330");

    expect(result).toEqual({ symbol: "2330", entries: [RAW_ENTRY_SINGLE_SOURCE] });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/capital-stock-history?symbol=2330");
  });

  it("returns an empty entries array for a symbol with no history, without throwing", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "9999", entries: [] } });

    await expect(fetchCapitalStockHistory("9999")).resolves.toEqual({ symbol: "9999", entries: [] });
  });

  // analysis-ts confirmed ~9% of real rows have more than one non-zero changeSource field — normalization
  // must preserve every field independently, not collapse to a single "dominant source".
  it("preserves multiple simultaneous non-zero changeSource fields on one entry", async () => {
    const entry = {
      ...RAW_ENTRY_SINGLE_SOURCE,
      changeSource: { ...RAW_ENTRY_SINGLE_SOURCE.changeSource, cashIncrease: "1000000", mergerIncrease: "500000" },
    };
    mockFetchOnce({ ok: true, body: { symbol: "2330", entries: [entry] } });

    const result = await fetchCapitalStockHistory("2330");

    expect(result.entries[0]?.changeSource.cashIncrease).toBe("1000000");
    expect(result.entries[0]?.changeSource.mergerIncrease).toBe("500000");
  });

  // capitalReduction is signed (negative = reduction) — must be passed through as-is, never abs()'d.
  it("preserves a negative capitalReduction value as-is", async () => {
    const entry = { ...RAW_ENTRY_SINGLE_SOURCE, changeSource: { ...RAW_ENTRY_SINGLE_SOURCE.changeSource, capitalReduction: "-1500000000" } };
    mockFetchOnce({ ok: true, body: { symbol: "2330", entries: [entry] } });

    const result = await fetchCapitalStockHistory("2330");

    expect(result.entries[0]?.changeSource.capitalReduction).toBe("-1500000000");
  });

  it("keeps other/remarks null when analysis-ts sends null", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330", entries: [RAW_ENTRY_SINGLE_SOURCE] } });

    const result = await fetchCapitalStockHistory("2330");

    expect(result.entries[0]?.changeSource.other).toBeNull();
    expect(result.entries[0]?.remarks).toBeNull();
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchCapitalStockHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchCapitalStockHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing an entries array", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330" } });

    await expect(fetchCapitalStockHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});
