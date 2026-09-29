import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchBusinessCycleIndicator,
  fetchCbcPolicyRate,
  fetchUsPolicyRate,
  fetchCpi,
  fetchGdp,
  fetchGovBondYield10y,
  fetchGovBondYield10yHistory,
  fetchMonetaryAggregate,
  fetchStockMarketSummary,
  fetchUsdTwdRate,
} from "@/infrastructure/analysisApi/macro/macro.client.js";

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

// Real shape given directly by analysis-ts (2026-09-21): rates are JSON numbers (percent, 2 = 2%),
// changeBp is basis points and null only on the very first row of the full history.
const RAW_BODY = {
  entries: [
    { effectiveDate: "1989-04-01", discountRate: 5.5, collateralAccommodationRate: 6.5, unsecuredAccommodationRate: 10, changeBp: null },
    { effectiveDate: "2022-03-18", discountRate: 1.375, collateralAccommodationRate: 1.75, unsecuredAccommodationRate: 3.625, changeBp: 25 },
    { effectiveDate: "2022-06-17", discountRate: 1.5, collateralAccommodationRate: 1.875, unsecuredAccommodationRate: 3.75, changeBp: 12.5 },
  ],
};

// 上游 2026-09-29 的實際回應（我自己打過確認，不是照通知抄）：targetUpper/targetLower 是百分比數字，
// changeBp 是目標區間上緣的變動基點，**只有完整歷史的第一筆是 null**。
const US_RAW_BODY = {
  entries: [
    { effectiveDate: "1982-09-27", targetUpper: 10.25, targetLower: 10.25, changeBp: null },
    { effectiveDate: "2008-12-16", targetUpper: 0.25, targetLower: 0, changeBp: -75 },
    { effectiveDate: "2026-09-17", targetUpper: 4, targetLower: 3.75, changeBp: 25 },
  ],
};

describe("fetchUsPolicyRate", () => {
  it("原樣轉發數字，不帶 from 時不加任何 query 參數", async () => {
    mockFetchOnce({ ok: true, body: US_RAW_BODY });

    const result = await fetchUsPolicyRate();

    expect(result).toEqual(US_RAW_BODY);
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/macro/us-policy-rate");
  });

  /**
   * 這一條守的是 `Number(null)` 那個陷阱：它會變成 0，而「沒有更早的可比較」與「這次沒有調整」在圖上
   * 是完全不同的意思——後者會在 1982 年畫出一個不存在的持平點。所以 changeBp 必須是 toNumberOrNull。
   */
  it("完整歷史第一筆的 changeBp 維持 null，不會變成 0", async () => {
    mockFetchOnce({ ok: true, body: US_RAW_BODY });

    const result = await fetchUsPolicyRate();

    expect(result.entries[0]?.changeBp).toBeNull();
    expect(result.entries[0]?.changeBp).not.toBe(0);
  });

  /** 2008-12-16 之前 upper 與 lower 相等（單一目標值），這一列不能被當成異常處理掉。 */
  it("區間制之前 upper 與 lower 相等時原樣保留", async () => {
    mockFetchOnce({ ok: true, body: US_RAW_BODY });

    const result = await fetchUsPolicyRate();

    expect(result.entries[0]?.targetUpper).toBe(10.25);
    expect(result.entries[0]?.targetLower).toBe(10.25);
  });

  it("有給 from 時才轉發", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await fetchUsPolicyRate("2024-06-01");

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get("from")).toBe("2024-06-01");
  });

  it("上游非 2xx 時丟 502", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchUsPolicyRate()).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchCbcPolicyRate", () => {
  it("requests /macro/cbc-policy-rate with no query params by default and passes numbers through unchanged", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchCbcPolicyRate();

    expect(result).toEqual(RAW_BODY);
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/macro/cbc-policy-rate");
  });

  it("forwards from when given", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await fetchCbcPolicyRate("2020-01-01");

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/macro/cbc-policy-rate?from=2020-01-01");
  });

  // The first row of the full history has nothing earlier to diff against — must stay null, never 0.
  it("keeps changeBp null on the first historical row rather than coercing to 0", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchCbcPolicyRate();

    expect(result.entries[0]?.changeBp).toBeNull();
    expect(result.entries[1]?.changeBp).toBe(25);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchCbcPolicyRate()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchCbcPolicyRate()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing an "entries" array', async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchCbcPolicyRate()).rejects.toMatchObject({ statusCode: 502 });
  });
});

// --- 總經特區 series (2026-09-22) ---
// The recurring bug class these guard against: a query param analysis-ts added that this proxy silently
// dropped (taiex-daily-price's interval, 2026-09-21). Every optional param must be forwarded when given
// and omitted entirely when not, so a bare call keeps the exact upstream request/defaults.

function calledUrl(): URL {
  return vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
}

describe("monthly series (business-cycle-indicator / monetary-aggregate / gov-bond-yield-10y-history / stock-market-summary)", () => {
  it.each([
    ["business-cycle-indicator", fetchBusinessCycleIndicator],
    ["monetary-aggregate", fetchMonetaryAggregate],
    ["gov-bond-yield-10y-history", fetchGovBondYield10yHistory],
    ["stock-market-summary", fetchStockMarketSummary],
  ] as const)("%s forwards from when given and omits it when not", async (path, fetcher) => {
    mockFetchOnce({ ok: true, body: { entries: [] } });
    await fetcher("2020-01");
    expect(calledUrl().toString()).toBe(`http://filters.test/macro/${path}?from=2020-01`);

    mockFetchOnce({ ok: true, body: { entries: [] } });
    await fetcher();
    expect(calledUrl().toString()).toBe(`http://filters.test/macro/${path}`);
  });

  // Real shape from analysis-ts (2026-09-22). signalLight is a Chinese string, passed through unmapped.
  it("business-cycle-indicator passes numbers and the signalLight string through, nulls preserved", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        entries: [
          {
            period: "2026-07", year: 2026, month: 7,
            leadingIndexComposite: 138.625, leadingIndexDetrended: 104.6337,
            coincidentIndexComposite: 141.5038, coincidentIndexDetrended: 106.805,
            laggingIndexComposite: 138.8361, laggingIndexDetrended: 104.7914,
            signalScore: 41, signalLight: "紅",
          },
          { period: "1982-01", year: 1982, month: 1, leadingIndexComposite: null, signalScore: null, signalLight: null },
        ],
      },
    });

    const result = await fetchBusinessCycleIndicator();

    expect(result.entries[0]).toMatchObject({ signalScore: 41, signalLight: "紅", leadingIndexDetrended: 104.6337 });
    expect(result.entries[1]).toMatchObject({ leadingIndexComposite: null, signalScore: null, signalLight: null });
  });

  // Real shape (2026-09-22). avgTaiex is a monthly average, passed through untouched — no resampling.
  it("stock-market-summary passes all seven numeric fields through, nulls preserved", async () => {
    mockFetchOnce({
      ok: true,
      body: { entries: [
        { period: "2026-07", year: 2026, month: 7, listedCompanies: 1083, totalParValue: 7910895, totalMarketValue: 140848179, totalTradingValue: 20732353, avgDailyTradingValue: 942380, avgTaiex: 44366.29, avgTaiexYoyPercent: 93.208 },
        { period: "1987-05", year: 1987, month: 5, listedCompanies: 130, avgTaiex: 1500.2, avgTaiexYoyPercent: null },
      ] },
    });

    const result = await fetchStockMarketSummary();

    expect(result.entries[0]).toMatchObject({ listedCompanies: 1083, avgTaiex: 44366.29, avgTaiexYoyPercent: 93.208 });
    expect(result.entries[1]).toMatchObject({ avgTaiexYoyPercent: null, totalParValue: null });
  });

  it("gov-bond-yield-10y-history normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: { entries: [{ period: "2026-07", year: 2026, month: 7, yieldPct: 1.9 }] } });

    const result = await fetchGovBondYield10yHistory();

    expect(result).toEqual({ entries: [{ period: "2026-07", year: 2026, month: 7, yieldPct: 1.9 }] });
  });
});

describe("fetchGovBondYield10y (snapshot)", () => {
  it("requests /macro/gov-bond-yield-10y and passes the snapshot through", async () => {
    mockFetchOnce({ ok: true, body: { yieldPct: 1.9, asOfMonth: "2026-07", fieldStatuses: {}, warnings: [] } });

    const result = await fetchGovBondYield10y();

    expect(result).toEqual({ yieldPct: 1.9, asOfMonth: "2026-07", fieldStatuses: {}, warnings: [] });
    expect(calledUrl().toString()).toBe("http://filters.test/macro/gov-bond-yield-10y");
  });

  it("throws a 502 AppError when the response is missing yieldPct", async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchGovBondYield10y()).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchUsdTwdRate", () => {
  it("forwards limit and interval when given", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await fetchUsdTwdRate(2000, "monthly");

    expect(calledUrl().toString()).toBe("http://filters.test/macro/usd-twd-rate?limit=2000&interval=monthly");
  });

  it("omits both params entirely when not given (upstream applies its own defaults)", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await fetchUsdTwdRate();

    expect(calledUrl().toString()).toBe("http://filters.test/macro/usd-twd-rate");
  });

  it("normalizes entries with numbers passed through", async () => {
    mockFetchOnce({
      ok: true,
      body: { entries: [{ tradeDate: "2026-07-31", bankBuyingRate: 32.26, bankSellingRate: 32.36, interbankClosingRate: 32.292 }] },
    });

    const result = await fetchUsdTwdRate(1);

    expect(result).toEqual({ entries: [{ tradeDate: "2026-07-31", bankBuyingRate: 32.26, bankSellingRate: 32.36, interbankClosingRate: 32.292 }] });
  });
});

describe("fetchCpi", () => {
  it("forwards from and category when given, and echoes the resolved category from the response", async () => {
    mockFetchOnce({ ok: true, body: { category: "food", entries: [{ period: "2026-08", year: 2026, month: 8, indexValue: 119.86, yoyChangePercent: 0.79 }] } });

    const result = await fetchCpi("2026-06", "food");

    expect(calledUrl().toString()).toBe("http://filters.test/macro/cpi?from=2026-06&category=food");
    expect(result).toEqual({ category: "food", entries: [{ period: "2026-08", year: 2026, month: 8, indexValue: 119.86, yoyChangePercent: 0.79 }] });
  });

  it("omits both params when not given (upstream defaults category to total)", async () => {
    mockFetchOnce({ ok: true, body: { category: "total", entries: [] } });

    const result = await fetchCpi();

    expect(calledUrl().toString()).toBe("http://filters.test/macro/cpi");
    expect(result.category).toBe("total");
  });

  it("throws a 502 AppError when the response is missing the top-level category", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await expect(fetchCpi()).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchGdp", () => {
  // Real shape after analysis-ts 7e4b4358 (2026-09-22): contributionPoints only — a yoyChangePercent field
  // existed for a few hours that day and was removed; it must not be re-introduced here.
  it("forwards from (YYYY-Qn) and category, and normalizes quarterly entries", async () => {
    mockFetchOnce({ ok: true, body: { category: "exports", entries: [{ period: "2026-Q2", year: 2026, quarter: 2, contributionPoints: 16.07 }] } });

    const result = await fetchGdp("2026-Q1", "exports");

    expect(calledUrl().toString()).toBe("http://filters.test/macro/gdp?from=2026-Q1&category=exports");
    expect(result).toEqual({ category: "exports", entries: [{ period: "2026-Q2", year: 2026, quarter: 2, contributionPoints: 16.07 }] });
  });

  it("omits both params when not given (upstream defaults category to growth_rate)", async () => {
    mockFetchOnce({ ok: true, body: { category: "growth_rate", entries: [] } });

    const result = await fetchGdp();

    expect(calledUrl().toString()).toBe("http://filters.test/macro/gdp");
    expect(result.category).toBe("growth_rate");
  });
});
