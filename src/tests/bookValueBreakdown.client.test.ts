import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBookValueBreakdown } from "@/infrastructure/analysisApi/stock/bookValueBreakdown.client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FILTERS_URL = process.env.FILTERS_SERVICE_URL;

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://filters.test";
  process.env.BFF_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_FILTERS_URL === undefined) {
    delete process.env.FILTERS_SERVICE_URL;
  } else {
    process.env.FILTERS_SERVICE_URL = ORIGINAL_FILTERS_URL;
  }
});

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

/** 2330 的真實回應（2026-09-27 實測）。 */
const RAW_2330 = {
  fiscalYear: 2025,
  openingBvps: 165.37,
  netIncome: 66.24,
  otherComprehensiveIncome: -2.18,
  cashDividends: -20.5,
  capitalIssued: 0,
  shareCountEffect: 0,
  other: 0.05,
  closingBvps: 208.99,
};

describe("fetchBookValueBreakdown", () => {
  it("打 /companies/book-value-breakdown?symbol= 並原樣帶出九個欄位", async () => {
    mockFetchOnce({ symbol: "2330", entries: [RAW_2330] });

    const result = await fetchBookValueBreakdown("2330");

    expect(result).toEqual({ symbol: "2330", entries: [RAW_2330] });
    // 上游是 ?symbol= 的查詢參數形式，不是 /companies/:symbol/...
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/companies/book-value-breakdown?symbol=2330");
  });

  /**
   * 這一列的恆等式殘差恰好是 0.01（165.37 + 66.24 − 2.18 − 20.5 + 0 + 0 + 0.05 = 208.98 vs 208.99）。
   * **client 不得替它「修正」** —— 七個加項各自四捨五入到 2 位小數，±0.02 的殘差是正常的，
   * 而擅自調整任何一項會製造一個上游沒有的數字。實測 40 家 197 列有 18.8% 的列是這樣。
   */
  it("恆等式差 0.01 時照原樣帶出，不做校正", async () => {
    mockFetchOnce({ symbol: "2330", entries: [RAW_2330] });

    const e = (await fetchBookValueBreakdown("2330")).entries[0]!;
    const sum = e.openingBvps + e.netIncome + e.otherComprehensiveIncome + e.cashDividends + e.capitalIssued + e.shareCountEffect + e.other;

    expect(e.closingBvps).toBe(208.99);
    expect(Math.abs(sum - e.closingBvps)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(sum - e.closingBvps)).toBeGreaterThan(0);
  });

  /** 現金股利是負值。看起來瑣碎，但它擋的是「順手取絕對值」那類改動。 */
  it("cashDividends 保留負號", async () => {
    mockFetchOnce({ symbol: "2330", entries: [RAW_2330] });
    expect((await fetchBookValueBreakdown("2330")).entries[0]?.cashDividends).toBe(-20.5);
  });

  /** shareCountEffect 可以是真實的 0，也可以是負的小數（5904 的 2025 年度是 −0.03）。 */
  it("shareCountEffect 的 0 與負小數都保留", async () => {
    mockFetchOnce({
      symbol: "5904",
      entries: [
        { ...RAW_2330, fiscalYear: 2025, openingBvps: 6.75, netIncome: 2.95, otherComprehensiveIncome: 0, cashDividends: -2.27, capitalIssued: 0, shareCountEffect: -0.03, other: 0.21, closingBvps: 7.62 },
      ],
    });

    const e = (await fetchBookValueBreakdown("5904")).entries[0]!;
    expect(e.shareCountEffect).toBe(-0.03);
    expect(e.otherComprehensiveIncome).toBe(0);
    expect(e.capitalIssued).toBe(0);
  });

  it("查無資料回空陣列而不是丟錯", async () => {
    mockFetchOnce({ symbol: "9999", entries: [] });
    await expect(fetchBookValueBreakdown("9999")).resolves.toEqual({ symbol: "9999", entries: [] });
  });

  /**
   * 上游保證九個欄位都是數字，所以缺一個就丟 502 並指名 —— 跟 dividendHistory 同一個判斷，
   * 共用 analysisServiceClient 的 requireNumber。缺欄位只可能是版本錯開，靜默給 0 會讓瀑布圖
   * 悄悄少一段而恆等式仍然「看起來」成立。
   */
  it("缺任一數字欄位時丟 502 並指名欄位", async () => {
    const { shareCountEffect: _omitted, ...withoutShareCountEffect } = RAW_2330;
    mockFetchOnce({ symbol: "2330", entries: [withoutShareCountEffect] });

    await expect(fetchBookValueBreakdown("2330")).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("shareCountEffect"),
    });
  });

  it("回應缺 entries 陣列時丟 502", async () => {
    mockFetchOnce({ symbol: "2330" });
    await expect(fetchBookValueBreakdown("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("上游非 2xx 時丟 502", async () => {
    mockFetchOnce({}, false, 500);
    await expect(fetchBookValueBreakdown("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});
