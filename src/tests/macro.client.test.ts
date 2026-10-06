import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchBusinessCycleIndicator,
  fetchCbcPolicyRate,
  fetchUsPolicyRate,
  fetchEcbPolicyRate,
  fetchEquityRiskPremium,
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

// 依 analysis-ts 的 zod schema 構造（2026-09-29 他們剛上線、gov-ts 的表還沒推到可查詢的環境，
// 所以無法從真實回應取樣——這三列涵蓋的是 schema 允許的三種形狀，不是我看過的資料）。
const ECB_RAW_BODY = {
  entries: [
    // 整段歷史的第一筆：三個 changeBp 都沒有前值可比
    { effectiveDate: "1999-01-01", depositFacilityRate: 2, mainRefinancingRate: 3, marginalLendingRate: 4.5, mainRefinancingIsMinimumBid: false, depositFacilityChangeBp: null, mainRefinancingChangeBp: null, marginalLendingChangeBp: null },
    // 最低投標利率時期，而且某個利率當期沒有公布
    { effectiveDate: "2000-06-28", depositFacilityRate: 3.25, mainRefinancingRate: null, marginalLendingRate: 5.25, mainRefinancingIsMinimumBid: true, depositFacilityChangeBp: 0, mainRefinancingChangeBp: null, marginalLendingChangeBp: 0 },
    // 負利率時期
    { effectiveDate: "2014-06-11", depositFacilityRate: -0.1, mainRefinancingRate: 0.15, marginalLendingRate: 0.4, mainRefinancingIsMinimumBid: false, depositFacilityChangeBp: -10, mainRefinancingChangeBp: -10, marginalLendingChangeBp: -35 },
  ],
};

// 2026-09-29 直接打上游取樣的真實回應（不是依 schema 構造）。
const ERP_RAW_BODY = {
  windowStart: "1999-01", windowEnd: "2026-07", months: 331,
  marketReturnGeometric: 7.4362, marketReturnArithmetic: 9.5851, avgRiskFreeRate: 1.9256,
  erpGeometric: 5.5106, erpArithmetic: 7.6595,
  requestedWindow: {}, clippedToAvailableData: false,
  dataCoverage: { taiexDateRange: { min: "1999-01", max: "2026-09" }, riskFreeRateDateRange: { min: "1994-12", max: "2026-07" } },
  fieldStatuses: {}, warnings: [],
  supplySide: {
    erp: 5.1015, expectedInflation: 1.151, realEarningsGrowth: 4.2091, peGrowth: 0,
    dividendYield: 1.5929, riskFreeRate: 1.9, inflationMonths: 331, gdpQuarters: 110,
    dividendYieldTradeDate: "2026-09-24", dividendYieldCompanyCount: 829, dividendYieldMarketCapCoverage: 98.3966,
  },
};

describe("fetchEquityRiskPremium", () => {
  it("原樣轉發，沒有窗口參數時不加任何 query", async () => {
    mockFetchOnce({ ok: true, body: ERP_RAW_BODY });

    const result = await fetchEquityRiskPremium({});

    expect(result).toEqual(ERP_RAW_BODY);
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/macro/equity-risk-premium");
  });

  it("只轉發有給的窗口參數", async () => {
    mockFetchOnce({ ok: true, body: ERP_RAW_BODY });

    await fetchEquityRiskPremium({ startYear: 2015, startMonth: 1 });

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get("startYear")).toBe("2015");
    expect(url.searchParams.get("startMonth")).toBe("1");
    // 沒給的不能出現——多送一個 key 會讓上游回應的 requestedWindow 跟著多一欄。
    expect(url.searchParams.has("endYear")).toBe(false);
    expect(url.searchParams.has("endMonth")).toBe(false);
  });

  /** supplySide **整塊**可以是 null（兩種資料完全沒有重疊月份），不是每個欄位各自 null。 */
  it("supplySide 整塊是 null 時保持 null，不會變成一個全 null 的物件", async () => {
    mockFetchOnce({ ok: true, body: { ...ERP_RAW_BODY, supplySide: null } });

    expect((await fetchEquityRiskPremium({})).supplySide).toBeNull();
  });

  /**
   * peGrowth 是模型固定的 0，不是缺值——所以它走 Number 而不是 toNumberOrNull。如果哪天有人「順手統一」
   * 成 toNumberOrNull，0 仍然是 0（Number(0) 與 toNumberOrNull(0) 相同），這個測試守的是它**不會變成 null**。
   */
  it("peGrowth 的 0 是模型假設不是缺值，保持為 0", async () => {
    mockFetchOnce({ ok: true, body: ERP_RAW_BODY });

    const ss = (await fetchEquityRiskPremium({})).supplySide;
    expect(ss?.peGrowth).toBe(0);
    expect(ss?.peGrowth).not.toBeNull();
  });

  it("supplySide 裡個別欄位為 null 時保持 null", async () => {
    mockFetchOnce({ ok: true, body: { ...ERP_RAW_BODY, supplySide: { ...ERP_RAW_BODY.supplySide, erp: null, dividendYield: null } } });

    const ss = (await fetchEquityRiskPremium({})).supplySide;
    expect(ss?.erp).toBeNull();
    expect(ss?.dividendYield).toBeNull();
    // 同一塊裡沒壞的欄位要留著
    expect(ss?.expectedInflation).toBe(1.151);
  });

  it("上游非 2xx 時丟 502", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchEquityRiskPremium({})).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchEcbPolicyRate", () => {
  it("原樣轉發，不帶 from 時不加 query 參數", async () => {
    mockFetchOnce({ ok: true, body: ECB_RAW_BODY });

    const result = await fetchEcbPolicyRate();

    expect(result).toEqual(ECB_RAW_BODY);
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/macro/ecb-policy-rate");
  });

  /**
   * 六個數值欄位都可能是 null，而 `Number(null)` 是 0。在利率圖上那會變成兩個具體的謊：一條不存在
   * 的零利率線，以及一個「這次沒有調整」的假訊號。
   */
  it("null 的利率與 changeBp 都維持 null，不會變成 0", async () => {
    mockFetchOnce({ ok: true, body: ECB_RAW_BODY });

    const [first, second] = (await fetchEcbPolicyRate()).entries;

    expect(first?.depositFacilityChangeBp).toBeNull();
    expect(first?.mainRefinancingChangeBp).toBeNull();
    expect(second?.mainRefinancingRate).toBeNull();
    expect(second?.mainRefinancingChangeBp).toBeNull();
    // 而真實的 0 要留下來：第二列三個利率都沒變，changeBp 是 0 不是 null，兩者意思不同。
    expect(second?.depositFacilityChangeBp).toBe(0);
  });

  /** 負利率時期（2014-06~2022-07）：depositFacilityRate 是負數，不能被當成異常處理掉。 */
  it("負的存款機制利率原樣保留", async () => {
    mockFetchOnce({ ok: true, body: ECB_RAW_BODY });

    expect((await fetchEcbPolicyRate()).entries[2]?.depositFacilityRate).toBe(-0.1);
  });

  /**
   * `=== true` 而不是 `Boolean()`：上游漏掉這個欄位時 `Boolean(undefined)` 也是 false，讀起來跟
   * 「上游明確說 false」無法區分。這裡用一個缺欄位的畸形回應把那個差別釘住。
   */
  it("缺少 mainRefinancingIsMinimumBid 時得到 false，而不是被 truthy 判斷放行", async () => {
    const { mainRefinancingIsMinimumBid: _omitted, ...withoutFlag } = ECB_RAW_BODY.entries[1]!;
    mockFetchOnce({ ok: true, body: { entries: [{ ...withoutFlag, mainRefinancingIsMinimumBid: "yes" }] } });

    // 任何非布林值（包含 truthy 的字串）都不算 true——只有上游真的送 true 才是 true。
    expect((await fetchEcbPolicyRate()).entries[0]?.mainRefinancingIsMinimumBid).toBe(false);
  });

  it("有給 from 時才轉發", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await fetchEcbPolicyRate("2022-01-01");

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get("from")).toBe("2022-01-01");
  });

  it("上游非 2xx 時丟 502（gov-ts 的表還沒推上去時上游會 500）", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchEcbPolicyRate()).rejects.toMatchObject({ statusCode: 502 });
  });
});

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

  // 每個值是 { status, message } 物件。原本 String(value) 把它變成 "[object Object]"——一直是空物件所以沒人看到。
  it("passes fieldStatuses objects through instead of stringifying them", async () => {
    const fieldStatuses = { yieldPct: { status: "no_data", message: "本月尚未公布" } };
    mockFetchOnce({ ok: true, body: { yieldPct: 1.9, asOfMonth: "2026-08", fieldStatuses, warnings: [] } });

    const result = await fetchGovBondYield10y();

    expect(result.fieldStatuses).toEqual(fieldStatuses);
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
