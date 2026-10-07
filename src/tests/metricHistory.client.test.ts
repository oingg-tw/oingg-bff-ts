import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMetricHistory } from "@/infrastructure/analysisApi/stock/metricHistory.client.js";

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

// Real 2330 data given directly by analysis-ts (2026-09-07).
const RAW_BODY = {
  symbol: "2330",
  metricCode: "peRatio",
  basis: "TTM",
  total: 23,
  hasMore: false,
  // 2026-10-08 上游新增 coverage 與每股換算欄位；比值（peRatio）不是每股類，所以 restated／shareBasisDate 是 null。
  coverage: { from: "2019Q4", to: "2026Q2" },
  entries: [
    { fiscalYear: 2025, fiscalQuarter: 2, value: 13.55, nullReason: null, knowledgeDate: "2025-08-12", knowledgeDateIsFallback: false, formulaVersion: 3, dataType: "2", restated: null, shareBasisDate: null },
    { fiscalYear: 2025, fiscalQuarter: 3, value: 15.93, nullReason: null, knowledgeDate: "2025-11-11", knowledgeDateIsFallback: false, formulaVersion: 3, dataType: "2", restated: null, shareBasisDate: null },
  ],
};

describe("fetchMetricHistory", () => {
  it("requests /companies/metric-history with symbol/metricCode/basis and normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchMetricHistory("2330", "peRatio", "TTM");

    expect(result).toEqual(RAW_BODY);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/metric-history?symbol=2330&metricCode=peRatio&timeframe=TTM");
  });

  // bvps added by analysis-ts as a 4th metricCode (2026-09-07) — only allows basis=Q, confirmed live.
  it("accepts bvps as a metricCode", async () => {
    mockFetchOnce({
      ok: true,
      body: { symbol: "2330", metricCode: "bvps", basis: "Q", total: 23, hasMore: true, entries: [] },
    });

    await fetchMetricHistory("2330", "bvps", "Q");

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/metric-history?symbol=2330&metricCode=bvps&timeframe=Q");
  });

  // stockPrice added by analysis-ts as a 5th metricCode (2026-09-07) — the knowledgeDate-aligned close
  // price used to compute peRatio/pbRatio, replacing web-nuxt's peRatio×EPS derivation. Only basis=Q,
  // confirmed live.
  it("accepts stockPrice as a metricCode", async () => {
    mockFetchOnce({
      ok: true,
      body: { symbol: "2330", metricCode: "stockPrice", basis: "Q", total: 23, hasMore: true, entries: [] },
    });

    await fetchMetricHistory("2330", "stockPrice", "Q");

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/metric-history?symbol=2330&metricCode=stockPrice&timeframe=Q");
  });

  it("includes limit in the request when given", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    await fetchMetricHistory("2330", "peRatio", "TTM", 5);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe(
      "http://filters.test/companies/metric-history?symbol=2330&metricCode=peRatio&timeframe=TTM&limit=5",
    );
  });

  it("returns an empty entries array for an unbackfilled or unknown symbol, without throwing", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2317", metricCode: "peRatio", basis: "TTM", total: 0, hasMore: false, entries: [] } });

    await expect(fetchMetricHistory("2317", "peRatio", "TTM")).resolves.toEqual({
      symbol: "2317",
      metricCode: "peRatio",
      basis: "TTM",
      total: 0,
      hasMore: false,
      coverage: null,
      entries: [],
    });
  });

  it("passes through total/hasMore", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchMetricHistory("2330", "peRatio", "TTM");

    expect(result.total).toBe(23);
    expect(result.hasMore).toBe(false);
  });

  it("defaults total/hasMore to 0/false when analysis-ts's response is missing them", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330", metricCode: "peRatio", basis: "TTM", entries: [] } });

    const result = await fetchMetricHistory("2330", "peRatio", "TTM");

    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it("preserves a null value with its nullReason", async () => {
    const entry = { fiscalYear: 2024, fiscalQuarter: 4, value: null, nullReason: "缺少前四季損益表資料", knowledgeDate: "2025-02-10", knowledgeDateIsFallback: false, formulaVersion: 3, dataType: "2" };
    mockFetchOnce({ ok: true, body: { ...RAW_BODY, entries: [entry] } });

    const result = await fetchMetricHistory("2330", "peRatio", "TTM");

    expect(result.entries[0]?.value).toBeNull();
    expect(result.entries[0]?.nullReason).toBe("缺少前四季損益表資料");
  });

  // analysis-ts validates metricCode/basis compatibility itself (e.g. pbRatio only allows basis=Q) and
  // returns a 400 with a clear message — must be relayed as-is, not masked as a generic 502.
  it("relays analysis-ts's 400 message for an invalid metricCode/basis combination", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: 'metricCode "pbRatio" 不允許 basis "TTM"，允許的值：Q。' } });

    await expect(fetchMetricHistory("2330", "pbRatio", "TTM")).rejects.toMatchObject({
      statusCode: 400,
      message: 'metricCode "pbRatio" 不允許 basis "TTM"，允許的值：Q。',
    });
  });

  it("falls back to a generic 400 message when analysis-ts's 400 body has none", async () => {
    mockFetchOnce({ ok: false, status: 400, body: {} });

    await expect(fetchMetricHistory("2330", "peRatio", "TTM")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchMetricHistory("2330", "peRatio", "TTM")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx, non-400 status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchMetricHistory("2330", "peRatio", "TTM")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing an entries array", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330" } });

    await expect(fetchMetricHistory("2330", "peRatio", "TTM")).rejects.toMatchObject({ statusCode: 502 });
  });
});

/**
 * 2026-09-26 上游（analysis-ts commit b6d07abe）在每一格加了 formulaVersion，而這一層的 normalizer 是
 * **逐欄位**的——沒手動接就會被靜默丟掉，回應少一個欄位卻不會有任何錯誤。dividendHistory 就是這樣漏掉
 * 兩個欄位的，所以這裡把「有帶就要穿過去」和「沒帶不要炸」兩個方向都釘住。
 *
 * 用途是快取失效：跟 GET /metrics 的 formulaVersion 不一致，代表這個值還沒被新算法重算過，可以顯示但
 * 不該快取。這三支端點（metric-history / roe-history / roa-history）共用 normalizeFlatHistoryEntry，
 * 所以測這一支等於測三支。
 */
describe("fetchMetricHistory 的 formulaVersion", () => {
  it("上游帶的版本號會穿過 normalizer，不會被逐欄位正規化丟掉", async () => {
    mockFetchOnce({
      ok: true,
      body: { ...RAW_BODY, entries: [{ ...RAW_BODY.entries[0], formulaVersion: 7 }] },
    });

    const result = await fetchMetricHistory("2330", "peRatio", "TTM");

    expect(result.entries[0]?.formulaVersion).toBe(7);
  });

  /**
   * 缺席時給 null 而**不是**丟 502——刻意跟 dividendHistory 的處理相反，差別在「缺了會壞掉什麼」：
   * 那邊缺欄位會讓金額變成 NaN，使用者看到的是錯的數字；這裡缺了只是下游少一個「可能過期」的提示，
   * 值本身照樣正確。為了一個提示讓整張圖表打不開，不成比例。
   */
  it("上游沒帶版本號時給 null，不丟錯也不把欄位整個省略", async () => {
    const { formulaVersion: _dropped, ...withoutVersion } = RAW_BODY.entries[0]!;
    mockFetchOnce({ ok: true, body: { ...RAW_BODY, entries: [withoutVersion] } });

    const result = await fetchMetricHistory("2330", "peRatio", "TTM");

    expect(result.entries[0]).toHaveProperty("formulaVersion");
    expect(result.entries[0]?.formulaVersion).toBeNull();
    // 其他欄位不受影響：缺版本號不該連帶影響這一格的值。
    expect(result.entries[0]?.value).toBe(13.55);
  });

  // 版本號是數字，不是字串。上游若哪天改成 "3" 這種形狀，寧可退成 null 也不要讓下游拿字串去比對。
  it("版本號不是數字時退成 null", async () => {
    mockFetchOnce({
      ok: true,
      body: { ...RAW_BODY, entries: [{ ...RAW_BODY.entries[0], formulaVersion: "3" }] },
    });

    const result = await fetchMetricHistory("2330", "peRatio", "TTM");

    expect(result.entries[0]?.formulaVersion).toBeNull();
  });
});

/**
 * `dataType` 逐期標示這一期用合併（"2"）還是個體（"1"）報表。2026-09-27 加入，因為 analysis-ts 把 31 家
 * 「賣掉子公司後只申報個別報表」的公司的兩段歷史接成了一條線——**同一條數列裡轉換點之前是合併、之後是
 * 個別**，而公司層級的 metricDataType 只說得出「現在」是哪一種。
 *
 * web-nuxt 要這個欄位的理由不是「圖上會有斷點」（實測 2941 轉換點 +35% 跟它自己其他年度的 −20%／−29%
 * 同一個量級，斷點的擔憂不成立），而是口徑一致性：那個站到處在標示資料限制，默默把兩種口徑接成一條線
 * 跟那個立場矛盾。
 */
describe("fetchMetricHistory 的 dataType", () => {
  it("轉換公司的數列上，轉換點前後是不同的報表類型", async () => {
    // 貼近上游實際回應（2941，實測 2022 是 "2"、2023 起是 "1"）
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "2941", metricCode: "eps", basis: "FY", total: 5, hasMore: false,
        entries: [
          { fiscalYear: 2022, fiscalQuarter: 4, value: 3.09, nullReason: null, knowledgeDate: "2023-03-20", knowledgeDateIsFallback: false, formulaVersion: 2, dataType: "2" },
          { fiscalYear: 2023, fiscalQuarter: 4, value: 4.16, nullReason: null, knowledgeDate: "2024-03-20", knowledgeDateIsFallback: false, formulaVersion: 2, dataType: "1" },
        ],
      },
    });

    const entries = (await fetchMetricHistory("2941", "eps", "TTM")).entries;

    expect(entries.map((e) => e.dataType)).toEqual(["2", "1"]);
  });

  /**
   * **選填的理由不是「可能漏送」**：日頻指標（exchangePeRatio、live* 等）沒有報表類型的概念，上游不送
   * 這個欄位（實測 2330 的 exchangePeRatio.EOD 有 tradeDate、沒有 dataType）。所以 null 代表「不適用」，
   * 不是「不知道」——這一條擋的是「順手把它改成必填」那種改動。
   */
  it("日頻指標沒有 dataType 時是 null，不丟錯", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "2330", metricCode: "eps", basis: "TTM", total: 1, hasMore: false,
        entries: [
          { fiscalYear: 2026, fiscalQuarter: 2, value: 1.1, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 2, tradeDate: "2026-09-24" },
        ],
      },
    });

    const e = (await fetchMetricHistory("2330", "eps", "TTM")).entries[0];

    expect(e?.dataType).toBeNull();
    expect(e).toHaveProperty("dataType");
    expect(e?.value).toBe(1.1);
  });

  /**
   * `"undefined"` 是個合法字串，型別上過關，而下游拿它比 `=== "1"` 得到 false——症狀是「全部看起來都是
   * 合併報表」。這是 `String(r.dataType)` 會造成的，跟 `Number(null)` 變成 0 同一類（見
   * dailyPriceHistory.client.ts）。
   */
  it("dataType 不是 \"1\"/\"2\" 時退成 null，不會變成 \"undefined\" 這種字串", async () => {
    for (const bad of [undefined, null, "3", 1, "合併"]) {
      mockFetchOnce({
        ok: true,
        body: {
          symbol: "2330", metricCode: "eps", basis: "TTM", total: 1, hasMore: false,
          entries: [{ fiscalYear: 2026, fiscalQuarter: 2, value: 1.1, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false, formulaVersion: 2, dataType: bad }],
        },
      });
      const e = (await fetchMetricHistory("2330", "eps", "TTM")).entries[0];
      expect(e?.dataType, `dataType=${String(bad)} 應該退成 null`).toBeNull();
    }
  });
});

