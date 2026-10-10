import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBody, withLegacyQueryNames } from "@/shared/validation.js";
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
    { fiscalYear: 2025, fiscalQuarter: 4, value: 31.7, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false, formulaVersion: 3, dataType: "2", restated: null, shareBasisDate: null },
    { fiscalYear: 2026, fiscalQuarter: 1, value: 32.74, nullReason: null, knowledgeDate: "2026-05-12", knowledgeDateIsFallback: false, formulaVersion: 3, dataType: "2", restated: null, shareBasisDate: null },
  ],
};

const ROA_BODY = {
  symbol: "2330",
  metricCode: "roa",
  basis: "TTM",
  total: 20,
  hasMore: true,
  entries: [
    { fiscalYear: 2025, fiscalQuarter: 4, value: 21.65, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false, formulaVersion: 3, dataType: "2", restated: null, shareBasisDate: null },
  ],
};

describe("fetchRoeHistory", () => {
  it("requests /companies/roe-history with symbol/basis and normalizes entries, including total/hasMore", async () => {
    mockFetchOnce({ ok: true, body: ROE_BODY });

    const result = await fetchRoeHistory("2330", "TTM");

    expect(result).toEqual({ symbol: "2330", timeframe: "TTM", basis: "TTM", total: 20, hasMore: true, coverage: null, entries: ROE_BODY.entries });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/roe-history?symbol=2330&timeframe=TTM");
  });

  /**
   * 這裡原本有一條「accepts Q_ANN as a basis (allowed for roe/roa unlike metric-history)」，**它用 mock
   * 斷言了一件上游當時已經不成立的事**：上游 2026-09-14（054ae0b4）整批移除「單季年化」期別，我們的
   * schema 一直留著 Q_ANN，而因為上游是 mock 的，這條測試在那之後仍然是綠的。
   *
   * 教訓：**純轉發端點用 mock 驗「某個參數值可用」，驗的是我們的假設而不是上游的契約。** 那種斷言只能
   * 靠實打上游。所以這裡不再驗任何特定期別可不可用——basis 已改成由上游驗證（見 route.ts 的說明，
   * roe 與 roa 的合法集合已經不同，任何本地列舉必然在其中一支上是錯的），這一層只守「空值要被擋掉」。
   */
  it("timeframe 是空字串或缺少時被擋下，不送出空的期別；並存期舊名 basis 仍收、新名優先", () => {
    expect(() => parseBody(roeRoaHistoryQuerySchema, { timeframe: "" })).toThrow(/timeframe/);
    expect(() => parseBody(roeRoaHistoryQuerySchema, {})).toThrow(/timeframe/);
    // 期別本身不在這裡驗：上游是唯一來源，給不支援的值會回它自己的 400（原樣中繼）。
    expect(parseBody(roeRoaHistoryQuerySchema, { timeframe: "FY" })).toMatchObject({ timeframe: "FY" });
    expect(parseBody(roeRoaHistoryQuerySchema, withLegacyQueryNames({ basis: "FY" }, { basis: "timeframe" }))).toMatchObject({ timeframe: "FY" });
    expect(parseBody(roeRoaHistoryQuerySchema, withLegacyQueryNames({ basis: "Q", timeframe: "TTM" }, { basis: "timeframe" }))).toMatchObject({ timeframe: "TTM" });
  });

  it("includes limit when given", async () => {
    mockFetchOnce({ ok: true, body: ROE_BODY });

    await fetchRoeHistory("2330", "TTM", 5);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/roe-history?symbol=2330&timeframe=TTM&limit=5");
  });

  it("returns an empty entries array for an unbackfilled or unknown symbol, without throwing", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "ZZZZ", metricCode: "roe", basis: "TTM", total: 0, hasMore: false, entries: [] } });

    await expect(fetchRoeHistory("ZZZZ", "TTM")).resolves.toEqual({
      symbol: "ZZZZ",
      timeframe: "TTM",
      basis: "TTM",
      total: 0,
      hasMore: false,
      coverage: null,
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

    expect(result).toEqual({ symbol: "2330", timeframe: "TTM", basis: "TTM", total: 20, hasMore: true, coverage: null, entries: ROA_BODY.entries });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/roa-history?symbol=2330&timeframe=TTM");
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
