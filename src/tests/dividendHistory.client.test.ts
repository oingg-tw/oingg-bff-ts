import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDividendHistory } from "@/infrastructure/analysisApi/stock/dividendHistory.client.js";

/**
 * 這支 client 在 2026-09-19 上線時沒有測試，而它的 normalizer 是**逐欄位**的——上游新增欄位會被靜默
 * 丟棄，不會報錯。2026-09-25 上游加了 cashDividendFromEarnings / cashDividendFromLegalReserveAndCapitalSurplus，
 * 而 bff-ts 起初就是這樣把兩個欄位吞掉的（實測上游有、bff-ts 回應沒有）。
 *
 * 所以這裡的重點不是「有沒有回傳資料」，是**上游新增的欄位有沒有真的穿過這一層**，而且年度列與
 * events[] 兩層都要測——那次漏接就是兩層都漏。同樣的缺口讓 fetchDistribution 的 excludeZero bug
 * 活了下來，見那次的 commit 訊息。
 */

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

/** 貼近上游實際回應（2330 民國 114 年度，四次發放）。 */
const RAW_YEAR = {
  fiscalYear: 2025,
  rocFiscalYear: 114,
  cashDividend: 22,
  cashDividendFromEarnings: 22,
  cashDividendFromLegalReserveAndCapitalSurplus: 0,
  stockDividend: 0,
  totalDividend: 22,
  distributionCount: 4,
  exDividendDate: "2026-06-11",
  exRightsDate: null,
  paymentDate: "2026-07-09",
  eps: 66.26,
  payoutRatio: 33.2,
  yieldAtExDate: 1.32,
  knowledgeDate: "2026-05-27",
  events: [
    {
      fiscalQuarter: 1,
      cashDividend: 5,
      cashDividendFromEarnings: 5,
      cashDividendFromLegalReserveAndCapitalSurplus: 0,
      stockDividend: 0,
      exDividendDate: "2025-09-16",
      exRightsDate: null,
      paymentDate: "2025-10-09",
      announcementDate: "2025-09-01",
      closeAtExDate: 1280,
      yieldAtExDate: 0.39,
    },
  ],
};

describe("fetchDividendHistory", () => {
  it("把股利來源的兩個欄位一路帶到年度列與 events[]", async () => {
    mockFetchOnce({ symbol: "2330", entries: [RAW_YEAR] });
    const result = await fetchDividendHistory("2330");

    const year = result.entries[0];
    expect(year?.cashDividendFromEarnings).toBe(22);
    expect(year?.cashDividendFromLegalReserveAndCapitalSurplus).toBe(0);
    // 兩層都要：上次漏接是兩層一起漏的
    expect(year?.events[0]?.cashDividendFromEarnings).toBe(5);
    expect(year?.events[0]?.cashDividendFromLegalReserveAndCapitalSurplus).toBe(0);
  });

  /**
   * 沒有公積成分的公司拿到的是 0 而不是 null。看起來瑣碎，但它擋的是「把 0 正規化成 null」
   * 這類順手的改動——0 是「確實沒有這個成分」，null 會被下游讀成「不知道」。
   */
  it("公積成分為 0 時保留 0，不轉成 null", async () => {
    mockFetchOnce({ symbol: "2330", entries: [RAW_YEAR] });
    const result = await fetchDividendHistory("2330");
    expect(result.entries[0]?.cashDividendFromLegalReserveAndCapitalSurplus).not.toBeNull();
    expect(result.entries[0]?.cashDividendFromLegalReserveAndCapitalSurplus).toBe(0);
  });

  /**
   * 上游兩個來源各自四捨五入，相加可能跟合計差 0.01。**這一層不得替它「修正」**——合計才是權威值，
   * 而擅自調整其中一個來源會製造一個上游沒有的數字。
   */
  it("兩個來源相加跟合計差 0.01 時照原樣帶出，不做校正", async () => {
    mockFetchOnce({
      symbol: "1234",
      entries: [{ ...RAW_YEAR, cashDividend: 2.5, cashDividendFromEarnings: 1.26, cashDividendFromLegalReserveAndCapitalSurplus: 1.25, events: [] }],
    });
    const year = (await fetchDividendHistory("1234")).entries[0];
    expect(year?.cashDividend).toBe(2.5);
    expect(year?.cashDividendFromEarnings).toBe(1.26);
    expect(year?.cashDividendFromLegalReserveAndCapitalSurplus).toBe(1.25);
    expect((year?.cashDividendFromEarnings ?? 0) + (year?.cashDividendFromLegalReserveAndCapitalSurplus ?? 0)).toBeCloseTo(2.51, 10);
  });

  /**
   * `fromEarnings` 高於該年度 `eps` 是合法的，代表動用了以前年度累積盈餘。**但反向不成立**：
   * 不高於 eps 什麼都證明不了（實測只有約 11.8% 的公司年度推得出來），所以這不是一個可靠的偵測器，
   * 只是一個偶爾會亮的訊號。這裡要守的是 normalizer 不得把它當異常攔掉。
   */
  it("盈餘來源高於當年 eps 時不視為異常", async () => {
    mockFetchOnce({
      symbol: "5678",
      entries: [{ ...RAW_YEAR, cashDividend: 5, cashDividendFromEarnings: 5, cashDividendFromLegalReserveAndCapitalSurplus: 0, eps: 1.2, payoutRatio: 416.67, events: [] }],
    });
    const year = (await fetchDividendHistory("5678")).entries[0];
    expect(year?.cashDividendFromEarnings).toBe(5);
    expect(year?.eps).toBe(1.2);
    expect(year?.payoutRatio).toBe(416.67);
  });

  it("沒有年報的年度 eps 與 payoutRatio 是 null", async () => {
    mockFetchOnce({
      symbol: "2330",
      entries: [{ ...RAW_YEAR, fiscalYear: 2026, rocFiscalYear: 115, eps: null, payoutRatio: null, events: [] }],
    });
    const year = (await fetchDividendHistory("2330")).entries[0];
    expect(year?.eps).toBeNull();
    expect(year?.payoutRatio).toBeNull();
    // 但股利本身仍然要有值——年報還沒出不影響已經宣告的配息
    expect(year?.cashDividend).toBe(22);
    expect(year?.cashDividendFromEarnings).toBe(22);
  });

  /**
   * 2026-09-25 上游把 `payoutRatio` 的分子改成只算盈餘那一塊，所以全部來自公積的公司是 **0 不是
   * null**——那兩個值在下游意思完全不同（0 = 當年獲利一毛沒發，null = 算不出來）。bff-ts 只轉發，
   * 這個測試守的是「不要好心把 0 當成缺值處理」。真實案例：2882 國泰金 111 年度。
   */
  it("全部來自公積時 payoutRatio 是 0 而不是 null", async () => {
    mockFetchOnce({
      symbol: "2882",
      entries: [{ ...RAW_YEAR, rocFiscalYear: 111, cashDividend: 0.9, cashDividendFromEarnings: 0, cashDividendFromLegalReserveAndCapitalSurplus: 0.9, eps: 2.58, payoutRatio: 0, events: [] }],
    });
    const year = (await fetchDividendHistory("2882")).entries[0];
    expect(year?.payoutRatio).toBe(0);
    expect(year?.payoutRatio).not.toBeNull();
    expect(year?.cashDividendFromEarnings).toBe(0);
    expect(year?.cashDividend).toBe(0.9);
  });

  /**
   * **這一條是那天真正的 bug 的迴歸測試。** 上游改名、bff-ts 還讀舊名時，`Number(undefined)` 產生
   * NaN 並序列化成 null，而型別說那個欄位不可能是 null——版本錯開被型別吸收掉，只能靠手動打上游比對
   * 才發現。現在它會在邊界上丟 502 並指名是哪個欄位。
   *
   * 兩層都測：年度列與 events[] 各自都會讀那兩個欄位，只補一層的檢查等於只有一半的警報。
   */
  it("上游少了保證存在的數字欄位時丟 502 並指名欄位，而不是靜默變 null", async () => {
    const { cashDividendFromLegalReserveAndCapitalSurplus: _omitted, ...yearWithoutReserve } = RAW_YEAR;
    mockFetchOnce({ symbol: "2330", entries: [{ ...yearWithoutReserve, events: [] }] });
    await expect(fetchDividendHistory("2330")).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("cashDividendFromLegalReserveAndCapitalSurplus"),
    });

    const { cashDividendFromEarnings: _omitted2, ...eventWithoutEarnings } = RAW_YEAR.events[0]!;
    mockFetchOnce({ symbol: "2330", entries: [{ ...RAW_YEAR, events: [eventWithoutEarnings] }] });
    await expect(fetchDividendHistory("2330")).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("cashDividendFromEarnings"),
    });
  });

  /**
   * 2026-10-05 上游契約變更：公告沒填所屬年度的那幾次，年度是 null、集中在最後一列。這裡原本是
   * Number(r.fiscalYear)，2496 那一列因此被送成 fiscalYear 0——沒有錯誤，只是值悄悄錯了。
   */
  it("年度未填的那一列保留 null，不轉成 0", async () => {
    mockFetchOnce({ entries: [RAW_YEAR, { ...RAW_YEAR, fiscalYear: null, rocFiscalYear: null }] });

    const result = await fetchDividendHistory("2496");

    expect(result.entries.at(-1)).toMatchObject({ fiscalYear: null });
    expect(result.entries[0]!.fiscalYear).toBe(RAW_YEAR.fiscalYear);
  });

  it("查無資料回空陣列而不是丟錯", async () => {
    mockFetchOnce({ symbol: "9999", entries: [] });
    await expect(fetchDividendHistory("9999")).resolves.toEqual({ symbol: "9999", entries: [] });
  });

  it("回應缺 entries 陣列時丟 502", async () => {
    mockFetchOnce({ symbol: "2330" });
    await expect(fetchDividendHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("上游非 2xx 時丟 502", async () => {
    mockFetchOnce({}, false, 500);
    await expect(fetchDividendHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});
