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
  entries: [
    { fiscalYear: 2025, fiscalQuarter: 2, value: 13.55, nullReason: null, knowledgeDate: "2025-08-12", knowledgeDateIsFallback: false, formulaVersion: 3 },
    { fiscalYear: 2025, fiscalQuarter: 3, value: 15.93, nullReason: null, knowledgeDate: "2025-11-11", knowledgeDateIsFallback: false, formulaVersion: 3 },
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
    const entry = { fiscalYear: 2024, fiscalQuarter: 4, value: null, nullReason: "缺少前四季損益表資料", knowledgeDate: "2025-02-10", knowledgeDateIsFallback: false, formulaVersion: 3 };
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
