import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRoaHistory, fetchRoeHistory } from "@/domainBff/stock/roeRoaHistory.client.js";

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
    { fiscalYear: 2025, fiscalQuarter: 4, value: 31.7, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false },
    { fiscalYear: 2026, fiscalQuarter: 1, value: 32.74, nullReason: null, knowledgeDate: "2026-05-12", knowledgeDateIsFallback: false },
  ],
};

const ROA_BODY = {
  symbol: "2330",
  metricCode: "roa",
  basis: "TTM",
  total: 20,
  hasMore: true,
  entries: [
    { fiscalYear: 2025, fiscalQuarter: 4, value: 21.65, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false },
  ],
};

describe("fetchRoeHistory", () => {
  it("requests /companies/roe-history with symbol/basis and normalizes entries, including total/hasMore", async () => {
    mockFetchOnce({ ok: true, body: ROE_BODY });

    const result = await fetchRoeHistory("2330", "TTM");

    expect(result).toEqual({ symbol: "2330", basis: "TTM", total: 20, hasMore: true, entries: ROE_BODY.entries });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/roe-history?symbol=2330&basis=TTM");
  });

  it("accepts Q_ANN as a basis (allowed for roe/roa unlike metric-history)", async () => {
    mockFetchOnce({ ok: true, body: { ...ROE_BODY, basis: "Q_ANN" } });

    await fetchRoeHistory("2330", "Q_ANN");

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/roe-history?symbol=2330&basis=Q_ANN");
  });

  it("includes limit when given", async () => {
    mockFetchOnce({ ok: true, body: ROE_BODY });

    await fetchRoeHistory("2330", "TTM", 5);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/roe-history?symbol=2330&basis=TTM&limit=5");
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
    expect(calledUrl.toString()).toBe("http://filters.test/companies/roa-history?symbol=2330&basis=TTM");
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
