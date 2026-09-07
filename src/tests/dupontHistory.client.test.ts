import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDupontHistory } from "@/domainBff/stock/dupontHistory.client.js";

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
const Q_BODY = {
  symbol: "2330",
  basis: "Q",
  total: 20,
  hasMore: true,
  entries: [
    { fiscalYear: 2025, fiscalQuarter: 2, netProfitMarginPct: 42.65, assetTurnover: 0.13, equityMultiplier: 1.53, decomposedRoePct: 8.48, nullReason: null, knowledgeDate: "2025-08-12", knowledgeDateIsFallback: false },
  ],
};

// TTM entries observed with equityMultiplier null in real data — must be preserved as null, not
// coerced or dropped.
const TTM_BODY = {
  symbol: "2330",
  basis: "TTM",
  total: 20,
  hasMore: true,
  entries: [
    { fiscalYear: 2025, fiscalQuarter: 4, netProfitMarginPct: 45.1, assetTurnover: 0.48, equityMultiplier: null, decomposedRoePct: 31.61, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false },
  ],
};

describe("fetchDupontHistory", () => {
  it("requests /companies/dupont-history with symbol/basis and normalizes entries (dropping total/hasMore)", async () => {
    mockFetchOnce({ ok: true, body: Q_BODY });

    const result = await fetchDupontHistory("2330", "Q");

    expect(result).toEqual({ symbol: "2330", basis: "Q", entries: Q_BODY.entries });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/dupont-history?symbol=2330&basis=Q");
  });

  it("includes limit when given", async () => {
    mockFetchOnce({ ok: true, body: Q_BODY });

    await fetchDupontHistory("2330", "Q", 5);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/dupont-history?symbol=2330&basis=Q&limit=5");
  });

  // Observed live: equityMultiplier is null under basis=TTM for real 2330 data — must stay null, not
  // be coerced to 0 or dropped from the entry.
  it("preserves a null equityMultiplier as-is", async () => {
    mockFetchOnce({ ok: true, body: TTM_BODY });

    const result = await fetchDupontHistory("2330", "TTM");

    expect(result.entries[0]?.equityMultiplier).toBeNull();
    expect(result.entries[0]?.netProfitMarginPct).toBe(45.1);
    expect(result.entries[0]?.decomposedRoePct).toBe(31.61);
  });

  it("returns an empty entries array for an unbackfilled or unknown symbol, without throwing", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "ZZZZ", basis: "Q", total: 0, hasMore: false, entries: [] } });

    await expect(fetchDupontHistory("ZZZZ", "Q")).resolves.toEqual({ symbol: "ZZZZ", basis: "Q", entries: [] });
  });

  it("relays analysis-ts's 400 message for an invalid basis (e.g. Q_ANN, which dupont-history doesn't support)", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: '"basis" must be one of "Q", "TTM"' } });

    await expect(fetchDupontHistory("2330", "Q")).rejects.toMatchObject({
      statusCode: 400,
      message: '"basis" must be one of "Q", "TTM"',
    });
  });

  it("falls back to a generic 400 message when analysis-ts's 400 body has none", async () => {
    mockFetchOnce({ ok: false, status: 400, body: {} });

    await expect(fetchDupontHistory("2330", "Q")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchDupontHistory("2330", "Q")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx, non-400 status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchDupontHistory("2330", "Q")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing an entries array", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330" } });

    await expect(fetchDupontHistory("2330", "Q")).rejects.toMatchObject({ statusCode: 502 });
  });
});
