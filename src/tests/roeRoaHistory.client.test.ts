import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBody } from "@/shared/validation.js";
import { roeRoaHistoryQuerySchema } from "@/http/modules/stock/route.js";
import { fetchRoaHistory, fetchRoeHistory } from "@/infrastructure/analysisApi/stock/roeRoaHistory.client.js";

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
const ROE_BODY = {
  symbol: "2330",
  metricCode: "roe",
  basis: "TTM",
  total: 20,
  hasMore: true,
  entries: [
    { fiscalYear: 2025, fiscalQuarter: 4, value: 31.7, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false, formulaVersion: 3, dataType: "2" },
    { fiscalYear: 2026, fiscalQuarter: 1, value: 32.74, nullReason: null, knowledgeDate: "2026-05-12", knowledgeDateIsFallback: false, formulaVersion: 3, dataType: "2" },
  ],
};

const ROA_BODY = {
  symbol: "2330",
  metricCode: "roa",
  basis: "TTM",
  total: 20,
  hasMore: true,
  entries: [
    { fiscalYear: 2025, fiscalQuarter: 4, value: 21.65, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false, formulaVersion: 3, dataType: "2" },
  ],
};

describe("fetchRoeHistory", () => {
  it("requests /companies/roe-history with symbol/basis and normalizes entries, including total/hasMore", async () => {
    mockFetchOnce({ ok: true, body: ROE_BODY });

    const result = await fetchRoeHistory("2330", "TTM");

    expect(result).toEqual({ symbol: "2330", basis: "TTM", total: 20, hasMore: true, entries: ROE_BODY.entries });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/roe-history?symbol=2330&periodType=TTM");
  });

  /**
   * 這裡原本有一條「accepts Q_ANN as a basis (allowed for roe/roa unlike metric-history)」，**它用 mock
   * 斷言了一件上游其實不成立的事**：2026-10-01 實測上游 roe-history 的 periodType 只收 Q|TTM，給 Q_ANN
   * 回 400。因為上游是 mock 的，那條測試只是把我們自己的信念寫了兩遍，而且一直是綠的。
   *
   * 取代它的是下面在 route schema 上的檢查——真正守門的是那一層，而且那層不需要 mock 上游。
   * 教訓：**純轉發端點用 mock 驗「某個參數值可用」，驗的是我們的假設，不是上游的契約。**
   * 那種斷言只能靠實打上游，或者改成驗自己這一層的規則（像下面那樣）。
   */
  it("basis 的合法值跟上游逐字一致（Q、TTM），不含 Q_ANN 也不含 FY", () => {
    expect(parseBody(roeRoaHistoryQuerySchema, { basis: "Q" })).toMatchObject({ basis: "Q" });
    expect(parseBody(roeRoaHistoryQuerySchema, { basis: "TTM" })).toMatchObject({ basis: "TTM" });
    // Q_ANN：上游 400。FY：上游 2026-10-01 為 roe 新增，但只在複數 metrics-history，這支單數端點沒有。
    expect(() => parseBody(roeRoaHistoryQuerySchema, { basis: "Q_ANN" })).toThrow(/basis/);
    expect(() => parseBody(roeRoaHistoryQuerySchema, { basis: "FY" })).toThrow(/basis/);
  });

  it("includes limit when given", async () => {
    mockFetchOnce({ ok: true, body: ROE_BODY });

    await fetchRoeHistory("2330", "TTM", 5);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/roe-history?symbol=2330&periodType=TTM&limit=5");
  });

  it("returns an empty entries array for an unbackfilled or unknown symbol, without throwing", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "ZZZZ", metricCode: "roe", basis: "TTM", total: 0, hasMore: false, entries: [] } });

    await expect(fetchRoeHistory("ZZZZ", "TTM")).resolves.toEqual({
      symbol: "ZZZZ",
      basis: "TTM",
      total: 0,
      hasMore: false,
      entries: [],
    });
  });

  it("relays analysis-ts's 400 message for an invalid basis", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: '"basis" must be one of "Q", "Q_ANN", "TTM"' } });

    await expect(fetchRoeHistory("2330", "TTM")).rejects.toMatchObject({
      statusCode: 400,
      message: '"basis" must be one of "Q", "Q_ANN", "TTM"',
    });
  });

  it("throws a 502 AppError when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchRoeHistory("2330", "TTM")).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchRoaHistory", () => {
  it("requests /companies/roa-history with symbol/basis and normalizes entries, including total/hasMore", async () => {
    mockFetchOnce({ ok: true, body: ROA_BODY });

    const result = await fetchRoaHistory("2330", "TTM");

    expect(result).toEqual({ symbol: "2330", basis: "TTM", total: 20, hasMore: true, entries: ROA_BODY.entries });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/roa-history?symbol=2330&periodType=TTM");
  });

  it("throws a 502 AppError for a non-2xx, non-400 status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchRoaHistory("2330", "TTM")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing an entries array", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330" } });

    await expect(fetchRoaHistory("2330", "TTM")).rejects.toMatchObject({ statusCode: 502 });
  });
});
