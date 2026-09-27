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
  other: 0.06,
  dataType: "2" as const,
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
   * 恆等式精確到分（上游 2026-09-27 commit b1ce115f 從根本修掉，讓 other 吸收進位差額）。
   *
   * **比較方式本身是這條測試的重點**：用 `Math.round(x * 100)` 比整數分，**不要用
   * `Math.abs(sum - closing) > 0.01`**。後者在浮點下不可用——0.01 存不進 binary float，殘差為零的列
   * 會算出 0.010000000000019327 之類的值。我和 web-nuxt 各自都被這個騙過一次（我還因此在型別註解裡
   * 寫過「容差用 0.02」），所以這裡用會壞的那種寫法對照著釘住。
   */
  it("恆等式精確到分，而且要用整數分比較而不是浮點容差", async () => {
    mockFetchOnce({ symbol: "2330", entries: [RAW_2330] });

    const e = (await fetchBookValueBreakdown("2330")).entries[0]!;
    const cents = (x: number) => Math.round(x * 100);
    const sumCents =
      cents(e.openingBvps) + cents(e.netIncome) + cents(e.otherComprehensiveIncome) +
      cents(e.cashDividends) + cents(e.capitalIssued) + cents(e.shareCountEffect) + cents(e.other);

    expect(sumCents).toBe(cents(e.closingBvps));
  });

  /*
   * 原本這裡還斷言「同一份資料的浮點殘差不是 0」，想把「浮點會壞」也釘住。**那條斷言本身是脆的**：
   * 浮點殘差是不是 0 取決於具體數值，這一列剛好是 0，所以測試紅了。示範浮點問題屬於註解，不屬於斷言——
   * 用一組湊巧的數字去證明一個一般性的陷阱，只會製造一條下次換 fixture 就壞掉的測試。
   */

  /**
   * other 會吸收進位差額，所以「沒有未分類項目」的公司這一欄不再保證是 0。
   * 這條擋的是「other 非 0 就代表有特殊權益調整」那種讀法。
   */
  it("other 可以是進位差額量級的小數，不代表有特殊權益調整", async () => {
    mockFetchOnce({ symbol: "2330", entries: [{ ...RAW_2330, fiscalYear: 2023, other: 0.02 }] });
    expect((await fetchBookValueBreakdown("2330")).entries[0]?.other).toBe(0.02);
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
        { ...RAW_2330, fiscalYear: 2025, openingBvps: 6.75, netIncome: 2.95, otherComprehensiveIncome: 0, cashDividends: -2.27, capitalIssued: 0, shareCountEffect: -0.03, other: 0.21, dataType: "2" as const, closingBvps: 7.62 },
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

/**
 * 這支端點的 dataType 是**必填**（只有年度資料、沒有日頻指標），缺了丟 502。
 * 不預設成 "2"：那會把 31 家轉換公司的個別報表年度悄悄標成合併，而下游要這個欄位的整個用途就是區分兩者。
 */
describe("book-value-breakdown 的 dataType", () => {
  it("轉換公司逐年帶不同的報表類型", async () => {
    mockFetchOnce({
      symbol: "2941",
      entries: [
        { ...RAW_2330, fiscalYear: 2022, dataType: "2" },
        { ...RAW_2330, fiscalYear: 2023, dataType: "1" },
      ],
    });

    const entries = (await fetchBookValueBreakdown("2941")).entries;

    expect(entries.map((e) => e.dataType)).toEqual(["2", "1"]);
  });

  it("缺 dataType 或值不合法時丟 502，不預設成合併", async () => {
    for (const bad of [undefined, null, "3", "2 "]) {
      const { dataType: _omitted, ...rest } = RAW_2330;
      mockFetchOnce({ symbol: "2330", entries: [bad === undefined ? rest : { ...rest, dataType: bad }] });
      await expect(fetchBookValueBreakdown("2330"), `dataType=${String(bad)}`).rejects.toMatchObject({
        statusCode: 502,
        message: expect.stringContaining("dataType"),
      });
    }
  });
});

