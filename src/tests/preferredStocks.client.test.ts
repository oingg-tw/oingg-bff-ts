import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPreferredStocks } from "@/domainBff/stock/preferredStocks.client.js";

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

// Real entry given directly by analysis-ts (2026-09-06).
const RAW_ENTRY = {
  symbol: "1101B",
  name: "台泥乙特",
  isinCode: "TW0001101B05",
  listedDate: "2019-01-29",
  marketType: "上市",
  issueDate: "2018-12-13",
  issuePrice: 50,
  dividendRate: 1.75,
  nominalDividendRatePct: 3.5,
  currentYieldPct: 4.03,
  latestClosePrice: 43.45,
  latestPriceDate: "2026-09-04",
  cumulativeDividend: false,
  participatingExcessDividend: false,
  liquidationPreference: true,
  votingRights: false,
  convertible: false,
  conversionStartDate: null,
  redeemable: true,
  redemptionDate: "2023-12-13",
  redemptionConditions: "本公司得於發行日滿五年後之次日起按實際發行價格收回",
};

describe("fetchPreferredStocks", () => {
  it("requests /preferred-stocks without a symbol param when omitted, and normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: { entries: [RAW_ENTRY] } });

    const result = await fetchPreferredStocks();

    expect(result).toEqual({ entries: [RAW_ENTRY] });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/preferred-stocks");
  });

  it("requests /preferred-stocks?symbol= with the given symbol", async () => {
    mockFetchOnce({ ok: true, body: { entries: [RAW_ENTRY] } });

    await fetchPreferredStocks("1101B");

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/preferred-stocks?symbol=1101B");
  });

  it("returns an empty entries array for a symbol with no match, without throwing", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await expect(fetchPreferredStocks("NOPE")).resolves.toEqual({ entries: [] });
  });

  // dividendRate is a fixed NT$ amount, not a percentage — must be passed through as a plain number,
  // never reinterpreted or renamed to look like nominalDividendRatePct/currentYieldPct.
  it("keeps dividendRate, nominalDividendRatePct, and currentYieldPct as three distinct numeric fields", async () => {
    mockFetchOnce({ ok: true, body: { entries: [RAW_ENTRY] } });

    const result = await fetchPreferredStocks("1101B");

    expect(result.entries[0]?.dividendRate).toBe(1.75);
    expect(result.entries[0]?.nominalDividendRatePct).toBe(3.5);
    expect(result.entries[0]?.currentYieldPct).toBe(4.03);
  });

  it("keeps currentYieldPct/latestClosePrice null when analysis-ts sends null (no price data)", async () => {
    const entry = { ...RAW_ENTRY, currentYieldPct: null, latestClosePrice: null, latestPriceDate: null };
    mockFetchOnce({ ok: true, body: { entries: [entry] } });

    const result = await fetchPreferredStocks("1101B");

    expect(result.entries[0]?.currentYieldPct).toBeNull();
    expect(result.entries[0]?.latestClosePrice).toBeNull();
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchPreferredStocks()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchPreferredStocks()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing an entries array", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchPreferredStocks()).rejects.toMatchObject({ statusCode: 502 });
  });
});
