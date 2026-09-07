import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMetricHistory } from "@/domainBff/stock/metricHistory.client.js";

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
    { fiscalYear: 2025, fiscalQuarter: 2, value: 13.55, nullReason: null, knowledgeDate: "2025-08-12", knowledgeDateIsFallback: false },
    { fiscalYear: 2025, fiscalQuarter: 3, value: 15.93, nullReason: null, knowledgeDate: "2025-11-11", knowledgeDateIsFallback: false },
  ],
};

describe("fetchMetricHistory", () => {
  it("requests /companies/metric-history with symbol/metricCode/basis and normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchMetricHistory("2330", "peRatio", "TTM");

    expect(result).toEqual(RAW_BODY);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/metric-history?symbol=2330&metricCode=peRatio&basis=TTM");
  });

  // bvps added by analysis-ts as a 4th metricCode (2026-09-07) — only allows basis=Q, confirmed live.
  it("accepts bvps as a metricCode", async () => {
    mockFetchOnce({
      ok: true,
      body: { symbol: "2330", metricCode: "bvps", basis: "Q", total: 23, hasMore: true, entries: [] },
    });

    await fetchMetricHistory("2330", "bvps", "Q");

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/metric-history?symbol=2330&metricCode=bvps&basis=Q");
  });

  it("includes limit in the request when given", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    await fetchMetricHistory("2330", "peRatio", "TTM", 5);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe(
      "http://filters.test/companies/metric-history?symbol=2330&metricCode=peRatio&basis=TTM&limit=5",
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
    const entry = { fiscalYear: 2024, fiscalQuarter: 4, value: null, nullReason: "缺少前四季損益表資料", knowledgeDate: "2025-02-10", knowledgeDateIsFallback: false };
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
